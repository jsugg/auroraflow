import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { findAttribution } from './attribution-patterns.mjs';

const USAGE =
  'Usage: node scripts/attribution-guard.mjs <commit-msg <message-file> | pre-push <remote> | github>';
const ZERO_SHA = /^0+$/;
const DEFAULT_GITHUB_API_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const GIT_FIELD_SEPARATOR = '\x1f';
const GIT_RECORD_SEPARATOR = '\x1e';
const EXIT_PASS = 0;
const EXIT_VIOLATION = 1;
const EXIT_ERROR = 2;
const KIND_LABELS = Object.freeze({
  refName: 'ref-name',
  commitMessage: 'commit-message',
  email: 'email',
  label: 'label',
});

class GuardError extends Error {}

class GithubApiError extends Error {
  constructor(message, { retryable }) {
    super(message);
    this.retryable = retryable;
  }
}

function field(name, kind, value) {
  return { field: name, kind, value: value ?? '' };
}

function commitFields(sha, message, authorEmail, committerEmail) {
  const id = sha.slice(0, 12);
  return [
    field(`commit ${id} message`, 'commitMessage', message),
    field(`commit ${id} author email`, 'email', authorEmail),
    field(`commit ${id} committer email`, 'email', committerEmail),
  ];
}

export function findViolations(fields) {
  return fields.flatMap((candidate) => {
    const match = findAttribution(candidate.kind, candidate.value);
    return match === null ? [] : [{ field: candidate.field, kind: candidate.kind, match }];
  });
}

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', shell: false });
  if (result.error !== undefined || result.status !== 0) {
    throw new GuardError(
      `git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function commitExists(sha) {
  return spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { shell: false }).status === 0;
}

function gitCommitFields(revisionArgs) {
  const format = ['%H', '%ae', '%ce', '%B'].join('%x1f') + '%x1e';
  return runGit(['log', `--format=${format}`, ...revisionArgs])
    .split(GIT_RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.length > 0)
    .flatMap((record) => {
      const [sha, authorEmail, committerEmail, ...messageParts] = record.split(GIT_FIELD_SEPARATOR);
      return commitFields(sha, messageParts.join(GIT_FIELD_SEPARATOR), authorEmail, committerEmail);
    });
}

function commitMessageFields(messageFile) {
  if (messageFile === undefined) {
    throw new GuardError(USAGE);
  }
  return [field('commit message', 'commitMessage', readFileSync(messageFile, 'utf8'))];
}

// Git feeds pre-push one `<local-ref> <local-sha> <remote-ref> <remote-sha>` line per ref.
function prePushFields(remote, stdinText) {
  if (remote === undefined) {
    throw new GuardError(USAGE);
  }
  return stdinText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parts = line.split(/\s+/);
      if (parts.length !== 4) {
        throw new GuardError(`Unexpected pre-push input line: ${line}`);
      }
      const [, localSha, remoteRef, remoteSha] = parts;
      const refField = field(`pushed ref ${remoteRef}`, 'refName', remoteRef);
      if (ZERO_SHA.test(localSha)) {
        return [refField];
      }
      // A new ref, or a force push over a remote tip this clone has never fetched, introduces
      // everything not already on the remote.
      const revisions =
        ZERO_SHA.test(remoteSha) || !commitExists(remoteSha)
          ? [localSha, '--not', `--remotes=${remote}`]
          : [`${remoteSha}..${localSha}`];
      return [refField, ...gitCommitFields(revisions)];
    });
}

function createGithubApi(env) {
  const token = env.GITHUB_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new GuardError('GITHUB_TOKEN is required in github mode.');
  }
  const baseUrl = (env.GITHUB_API_URL ?? DEFAULT_GITHUB_API_URL).replace(/\/$/, '');
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };

  async function requestOnce(apiPath) {
    let response;
    try {
      response = await globalThis.fetch(`${baseUrl}${apiPath}`, {
        headers,
        signal: globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GithubApiError(`GitHub API request ${apiPath} failed: ${error.message}`, {
        retryable: true,
      });
    }
    if (response.ok) {
      return response.json();
    }
    const detail = (await response.text()).slice(0, 300);
    throw new GithubApiError(`GitHub API ${response.status} for ${apiPath}: ${detail}`, {
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  async function get(apiPath) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await requestOnce(apiPath);
      } catch (error) {
        if (!(error instanceof GithubApiError) || !error.retryable) {
          throw error;
        }
        if (attempt >= MAX_REQUEST_ATTEMPTS) {
          throw error;
        }
        await delay(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  // Returns every item plus the total the first page reports, so callers can refuse partial lists.
  async function paginate(apiPath, { selectItems, selectTotal }) {
    const separator = apiPath.includes('?') ? '&' : '?';
    const items = [];
    let total;
    for (let page = 1; ; page += 1) {
      const body = await get(`${apiPath}${separator}per_page=${PAGE_SIZE}&page=${page}`);
      total ??= selectTotal(body);
      const pageItems = selectItems(body);
      items.push(...pageItems);
      if (pageItems.length < PAGE_SIZE || (total !== undefined && items.length >= total)) {
        return { items, total };
      }
    }
  }

  return { get, paginate };
}

function apiCommitFields(commit) {
  return commitFields(
    commit.sha,
    commit.commit?.message,
    commit.commit?.author?.email,
    commit.commit?.committer?.email,
  );
}

async function pullRequestFields(api, repository, number) {
  if (!Number.isInteger(number)) {
    throw new GuardError('pull_request event payload has no pull request number.');
  }
  // Refetch instead of trusting the event payload, so edited/labeled re-runs see current state.
  const pull = await api.get(`/repos/${repository}/pulls/${number}`);
  if (!Number.isInteger(pull.commits)) {
    throw new GuardError(`Pull request #${number} API response has no commit count.`);
  }
  const { items: commits } = await api.paginate(`/repos/${repository}/pulls/${number}/commits`, {
    selectItems: (body) => body,
    selectTotal: () => pull.commits,
  });
  if (commits.length < pull.commits) {
    throw new GuardError(
      `Pull request #${number} reports ${pull.commits} commits but the API listed ${commits.length}; refusing to pass a partial check.`,
    );
  }
  return [
    field(`pull request #${number} title`, 'commitMessage', pull.title),
    field(`pull request #${number} body`, 'commitMessage', pull.body),
    field(`pull request #${number} head ref`, 'refName', pull.head?.ref),
    ...(pull.labels ?? []).map((label) => field(`label ${label.name}`, 'label', label.name)),
    ...commits.flatMap(apiCommitFields),
  ];
}

async function pushFields(api, repository, event) {
  const { before, after, ref } = event;
  if (typeof after !== 'string' || typeof before !== 'string') {
    throw new GuardError('push event payload has no before/after commit range.');
  }
  const refField = field(`pushed ref ${ref}`, 'refName', ref);
  if (ZERO_SHA.test(after)) {
    return [refField];
  }
  if (ZERO_SHA.test(before)) {
    return [refField, ...apiCommitFields(await api.get(`/repos/${repository}/commits/${after}`))];
  }
  const { items: commits, total } = await api.paginate(
    `/repos/${repository}/compare/${before}...${after}`,
    { selectItems: (body) => body.commits ?? [], selectTotal: (body) => body.total_commits },
  );
  if (!Number.isInteger(total) || commits.length < total) {
    throw new GuardError(
      `Push ${before}..${after} reports ${total} commits but the API listed ${commits.length}.`,
    );
  }
  return [refField, ...commits.flatMap(apiCommitFields)];
}

async function githubFields(env) {
  const repository = env.GITHUB_REPOSITORY;
  if (repository === undefined || env.GITHUB_EVENT_PATH === undefined) {
    throw new GuardError('GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required in github mode.');
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const api = createGithubApi(env);
  switch (env.GITHUB_EVENT_NAME) {
    case 'pull_request':
      return pullRequestFields(api, repository, event.pull_request?.number);
    case 'push':
      return pushFields(api, repository, event);
    default:
      throw new GuardError(
        `Unsupported event ${env.GITHUB_EVENT_NAME ?? '(none)'}; the guard fails closed.`,
      );
  }
}

function escapeAnnotation(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function reportViolations(violations, annotate) {
  for (const violation of violations) {
    const message = `${violation.field} matches the ${KIND_LABELS[violation.kind]} attribution pattern: ${JSON.stringify(violation.match)}`;
    console.error(
      annotate
        ? `::error title=Attribution Guard::${escapeAnnotation(message)}`
        : `attribution-guard: ${message}`,
    );
  }
  console.error(
    `attribution-guard: ${violations.length} attribution violation(s); remove tool attribution and retry.`,
  );
}

async function collectFields(command, args, env) {
  switch (command) {
    case 'commit-msg':
      return commitMessageFields(args[0]);
    case 'pre-push':
      return prePushFields(args[0], readFileSync(0, 'utf8'));
    case 'github':
      return githubFields(env);
    default:
      throw new GuardError(USAGE);
  }
}

export async function runAttributionGuard(argv, env) {
  const [command, ...args] = argv;
  const annotate = env.GITHUB_ACTIONS === 'true';
  try {
    const fields = await collectFields(command, args, env);
    const violations = findViolations(fields);
    if (violations.length > 0) {
      reportViolations(violations, annotate);
      return EXIT_VIOLATION;
    }
    console.log(`Attribution Guard passed: ${fields.length} field(s) checked.`);
    return EXIT_PASS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      annotate
        ? `::error title=Attribution Guard::${escapeAnnotation(message)}`
        : `attribution-guard: ${message}`,
    );
    return EXIT_ERROR;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runAttributionGuard(process.argv.slice(2), process.env);
}
