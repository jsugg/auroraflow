import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts/attribution-guard.mjs');
const PROCESS_TIMEOUT_MS = 20_000;
const ZERO_SHA = '0'.repeat(40);
const REPOSITORY = 'example/repo';
const CLEAN_EMAIL = 'dev@example.test';
const ATTRIBUTED_TRAILER = 'Co-authored-by: Codex <codex@example.com>';
const VENDOR_EMAIL = 'noreply@anthropic.com';

interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface FakeRoute {
  readonly status: number;
  readonly body: unknown;
}

interface ApiCommit {
  readonly sha: string;
  readonly commit: {
    readonly message: string;
    readonly author: { readonly email: string };
    readonly committer: { readonly email: string };
  };
}

const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function createTempDir(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), `auroraflow-attribution-${prefix}-`));
  temporaryDirectories.add(directory);
  return directory;
}

// Async spawn: the github-mode child calls back into this process's fake API server.
function runGuard(
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly stdin?: string;
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`attribution guard timed out: ${args.join(' ')}\n${stderr}`));
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(options.stdin ?? '');
  });
}

function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function commit(cwd: string, message: string, authorEmail = CLEAN_EMAIL): string {
  writeFileSync(path.join(cwd, 'file.txt'), `${message}\n${Date.now()}${Math.random()}\n`);
  git(cwd, ['add', 'file.txt']);
  git(cwd, ['commit', '--no-verify', '-q', '-m', message], {
    GIT_AUTHOR_NAME: 'Dev',
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: 'Dev',
    GIT_COMMITTER_EMAIL: CLEAN_EMAIL,
  });
  return git(cwd, ['rev-parse', 'HEAD']);
}

function createRepoWithRemote(): { readonly repo: string; readonly base: string } {
  const root = createTempDir('git');
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'work');
  git(root, ['init', '-q', '--bare', remote]);
  git(root, ['init', '-q', '-b', 'main', repo]);
  git(repo, ['config', 'user.name', 'Dev']);
  git(repo, ['config', 'user.email', CLEAN_EMAIL]);
  git(repo, ['remote', 'add', 'origin', remote]);
  const base = commit(repo, 'chore: initial');
  git(repo, ['push', '-q', '--no-verify', 'origin', 'main']);
  return { repo, base };
}

function prePushLine(remoteRef: string, localSha: string, remoteSha: string): string {
  return `refs/heads/local ${localSha} ${remoteRef} ${remoteSha}\n`;
}

function apiCommit(sha: string, message: string, authorEmail = CLEAN_EMAIL): ApiCommit {
  return {
    sha,
    commit: {
      message,
      author: { email: authorEmail },
      committer: { email: CLEAN_EMAIL },
    },
  };
}

describe('attribution guard commit-msg hook', () => {
  it('blocks an attributed commit message and names the field', async () => {
    const messageFile = path.join(createTempDir('msg'), 'COMMIT_EDITMSG');
    writeFileSync(messageFile, `fix: x\n\n${ATTRIBUTED_TRAILER}\n`);

    const result = await runGuard(['commit-msg', messageFile]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('commit message matches the commit-message attribution');
  });

  it('accepts a message that only names a provider as its subject', async () => {
    const messageFile = path.join(createTempDir('msg'), 'COMMIT_EDITMSG');
    writeFileSync(messageFile, 'fix(provider): handle openai timeout\n');

    const result = await runGuard(['commit-msg', messageFile]);

    expect(result.status).toBe(0);
  });

  it('fails closed on usage errors', async () => {
    expect((await runGuard(['commit-msg'])).status).toBe(2);
    expect((await runGuard(['unknown'])).status).toBe(2);
  });
});

describe('attribution guard pre-push hook', () => {
  it('passes clean commits introduced on a new ref', async () => {
    const { repo } = createRepoWithRemote();
    const head = commit(repo, 'feat: clean change');

    const result = await runGuard(['pre-push', 'origin'], {
      cwd: repo,
      stdin: prePushLine('refs/heads/feat/clean', head, ZERO_SHA),
    });

    expect(result.status).toBe(0);
  });

  it('blocks a tool-namespaced remote ref name', async () => {
    const { repo } = createRepoWithRemote();
    const head = commit(repo, 'feat: clean change');

    const result = await runGuard(['pre-push', 'origin'], {
      cwd: repo,
      stdin: prePushLine('refs/heads/codex/feature', head, ZERO_SHA),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pushed ref refs/heads/codex/feature');
  });

  it('blocks attributed messages and vendor author emails among introduced commits', async () => {
    const { repo, base } = createRepoWithRemote();
    commit(repo, `fix: x\n\n${ATTRIBUTED_TRAILER}`);
    const head = commit(repo, 'fix: y', VENDOR_EMAIL);

    const result = await runGuard(['pre-push', 'origin'], {
      cwd: repo,
      stdin: prePushLine('refs/heads/main', head, base),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/commit [0-9a-f]{12} message matches/);
    expect(result.stderr).toMatch(/commit [0-9a-f]{12} author email matches/);
  });

  it('checks only commits not already on the remote', async () => {
    const { repo } = createRepoWithRemote();
    const alreadyPushed = commit(repo, `fix: x\n\n${ATTRIBUTED_TRAILER}`);
    git(repo, ['push', '-q', '--no-verify', 'origin', 'main']);
    const head = commit(repo, 'fix: follow-up');

    const result = await runGuard(['pre-push', 'origin'], {
      cwd: repo,
      stdin: prePushLine('refs/heads/main', head, alreadyPushed),
    });

    expect(result.status).toBe(0);
  });

  it('allows deleting a ref without scanning commits', async () => {
    const { repo } = createRepoWithRemote();

    const result = await runGuard(['pre-push', 'origin'], {
      cwd: repo,
      stdin: prePushLine('refs/heads/old-topic', ZERO_SHA, git(repo, ['rev-parse', 'HEAD'])),
    });

    expect(result.status).toBe(0);
  });

  it('fails closed on malformed hook input', async () => {
    const { repo } = createRepoWithRemote();

    const result = await runGuard(['pre-push', 'origin'], { cwd: repo, stdin: 'garbage\n' });

    expect(result.status).toBe(2);
  });
});

describe('attribution guard github mode', () => {
  const routes = new Map<string, FakeRoute[]>();
  let server: Server;
  let apiUrl: string;

  beforeAll(async () => {
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const queue = routes.get(request.url ?? '');
      const route = queue !== undefined && queue.length > 1 ? queue.shift() : queue?.[0];
      response.writeHead(route?.status ?? 404, { 'content-type': 'application/json' });
      response.end(JSON.stringify(route?.body ?? { message: 'Not Found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    routes.clear();
  });

  function route(url: string, ...responses: FakeRoute[]): void {
    routes.set(url, responses);
  }

  function githubEnv(eventName: string, payload: unknown): NodeJS.ProcessEnv {
    const eventPath = path.join(createTempDir('event'), 'event.json');
    writeFileSync(eventPath, JSON.stringify(payload));
    return {
      GITHUB_ACTIONS: 'true',
      GITHUB_API_URL: apiUrl,
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_TOKEN: 'test-token',
    };
  }

  function routePullRequest(
    number: number,
    overrides: {
      readonly title?: string;
      readonly body?: string | null;
      readonly headRef?: string;
      readonly labels?: readonly string[];
      readonly commits?: readonly ApiCommit[];
      readonly commitCount?: number;
    } = {},
  ): void {
    const commits = overrides.commits ?? [apiCommit('a'.repeat(40), 'feat: clean')];
    route(`/repos/${REPOSITORY}/pulls/${number}`, {
      status: 200,
      body: {
        title: overrides.title ?? 'feat: clean change',
        body: overrides.body === undefined ? 'Plain description.' : overrides.body,
        head: { ref: overrides.headRef ?? 'feat/clean' },
        labels: (overrides.labels ?? ['dependencies']).map((name) => ({ name })),
        commits: overrides.commitCount ?? commits.length,
      },
    });
    route(`/repos/${REPOSITORY}/pulls/${number}/commits?per_page=100&page=1`, {
      status: 200,
      body: commits,
    });
  }

  it('passes a clean pull request', async () => {
    routePullRequest(7, { body: null });

    const result = await runGuard(['github'], {
      env: githubEnv('pull_request', { pull_request: { number: 7 } }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Attribution Guard passed');
  });

  it('judges the refetched pull request, not the event payload', async () => {
    routePullRequest(8, { body: 'Details\n\nGenerated by Codex' });

    const result = await runGuard(['github'], {
      env: githubEnv('pull_request', {
        pull_request: { number: 8, title: 'clean', body: 'clean' },
      }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('::error title=Attribution Guard::pull request #8 body');
  });

  it('checks title, head ref, labels, and every commit field', async () => {
    routePullRequest(9, {
      title: 'fix: y\n\nWritten with OpenAI Codex.',
      headRef: 'claude/topic',
      labels: ['dependencies', 'codex-review'],
      commits: [
        apiCommit('b'.repeat(40), 'feat: clean'),
        apiCommit('c'.repeat(40), 'fix: z', VENDOR_EMAIL),
      ],
    });

    const result = await runGuard(['github'], {
      env: githubEnv('pull_request', { pull_request: { number: 9 } }),
    });

    expect(result.status).toBe(1);
    for (const fieldName of [
      'pull request #9 title',
      'pull request #9 head ref',
      'label codex-review',
      `commit ${'c'.repeat(12)} author email`,
    ]) {
      expect(result.stderr).toContain(fieldName);
    }
    expect(result.stderr).not.toContain('label dependencies');
  });

  it('refuses to pass when the API lists fewer commits than the pull request has', async () => {
    routePullRequest(10, { commitCount: 300 });

    const result = await runGuard(['github'], {
      env: githubEnv('pull_request', { pull_request: { number: 10 } }),
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refusing to pass a partial check');
  });

  it('audits every commit of a push to main', async () => {
    const before = '1'.repeat(40);
    const after = '2'.repeat(40);
    route(`/repos/${REPOSITORY}/compare/${before}...${after}?per_page=100&page=1`, {
      status: 200,
      body: {
        total_commits: 2,
        commits: [
          apiCommit('d'.repeat(40), 'feat: clean'),
          apiCommit('e'.repeat(40), 'fix: v\n\nSession: https://claude.ai/code/session_123'),
        ],
      },
    });

    const result = await runGuard(['github'], {
      env: githubEnv('push', { ref: 'refs/heads/main', before, after }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`commit ${'e'.repeat(12)} message`);
  });

  it('retries a transient API failure before judging', async () => {
    const before = '3'.repeat(40);
    const after = '4'.repeat(40);
    route(
      `/repos/${REPOSITORY}/compare/${before}...${after}?per_page=100&page=1`,
      { status: 502, body: { message: 'Bad Gateway' } },
      { status: 200, body: { total_commits: 1, commits: [apiCommit(after, 'feat: clean')] } },
    );

    const result = await runGuard(['github'], {
      env: githubEnv('push', { ref: 'refs/heads/main', before, after }),
    });

    expect(result.status).toBe(0);
  });

  it('fails closed on API errors and unsupported events', async () => {
    const missing = await runGuard(['github'], {
      env: githubEnv('pull_request', { pull_request: { number: 404 } }),
    });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('GitHub API 404');

    const unsupported = await runGuard(['github'], {
      env: githubEnv('issue_comment', {}),
    });
    expect(unsupported.status).toBe(2);
    expect(unsupported.stderr).toContain('fails closed');
  });
});
