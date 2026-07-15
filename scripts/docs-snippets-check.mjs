#!/usr/bin/env node
// Type-checks the TypeScript snippets in the documentation against the package's own
// source, so a published example cannot drift from the API it demonstrates.
//
// Snippets are written to a scratch project under .cache/ and compiled with `tsc --noEmit`.
// `auroraflow` and `auroraflow/playwright` resolve to src/, so no build step is required
// and the check never sees a stale dist/.
//
// Documentation snippets are deliberate fragments, so the scratch project accommodates them:
//
//   * An ambient `page: Page` is always in scope, because docs act on the reader's page.
//   * Each snippet file is a module, so top-level `await` is legal.
//   * A snippet whose first line names its file (`// tests/login.spec.ts`) is written to
//     that path inside its document's scratch directory, so a multi-file walkthrough
//     compiles as the coherent project the reader is told to build.
//
// Two directives may sit directly above a fence:
//
//   <!-- snippet: context
//   import { RedisClient } from 'auroraflow';
//   declare const client: RedisClient;
//   -->
//
// prepends setup that the prose already established but the example does not repeat, and:
//
//   <!-- snippet: no-compile (API signature reference, not runnable code) -->
//
// exempts a snippet that genuinely cannot compile. The reason is required, and the opt-out
// count is always reported so exemptions stay visible and rare.
//
// Usage: node scripts/docs-snippets-check.mjs [--json]

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const SCRATCH_DIR = path.join(REPO_ROOT, '.cache', 'docs-snippets');
const TYPECHECK_TIMEOUT_MS = 120_000;

const SNIPPET_DOCS = [
  'README.md',
  'docs/getting-started.md',
  'docs/writing-tests.md',
  'docs/api.md',
  'docs/configuration.md',
];

const TYPESCRIPT_FENCE_LANGUAGES = new Set(['ts', 'typescript']);
const OPT_OUT_PATTERN = /^snippet:\s*no-compile\s*\(([^)]+)\)$/u;
const CONTEXT_PATTERN = /^snippet:\s*context\s*\n([\s\S]*)$/u;
const DECLARED_FILENAME_PATTERN = /^\/\/\s*([A-Za-z0-9_./-]+\.ts)\s*$/u;

/** Ambient context shared by every snippet: docs act on the page the reader already has. */
const AMBIENT_CONTEXT = `import type { Page } from 'playwright';

declare global {
  const page: Page;
}

export {};
`;

function scratchTsconfig() {
  // `paths` without `baseUrl` resolve relative to this tsconfig, which keeps the scratch
  // project working on TypeScript 6, where `baseUrl` is deprecated.
  const toRepoRoot = path.relative(SCRATCH_DIR, REPO_ROOT).split(path.sep).join('/');
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        lib: ['ES2023', 'DOM'],
        types: ['node'],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        paths: {
          auroraflow: [`${toRepoRoot}/src/index.ts`],
          'auroraflow/playwright': [`${toRepoRoot}/src/playwright.ts`],
        },
      },
      include: ['./**/*.ts'],
    },
    null,
    2,
  )}\n`;
}

/** Body of the HTML comment immediately above `fenceIndex`, or null when there is none. */
function directiveAbove(lines, fenceIndex) {
  let end = fenceIndex - 1;
  while (end >= 0 && lines[end].trim().length === 0) {
    end -= 1;
  }
  if (end < 0 || !lines[end].trimEnd().endsWith('-->')) {
    return null;
  }

  let start = end;
  while (start >= 0 && !lines[start].trimStart().startsWith('<!--')) {
    start -= 1;
  }
  if (start < 0) {
    return null;
  }

  return lines
    .slice(start, end + 1)
    .join('\n')
    .replace(/^\s*<!--/u, '')
    .replace(/-->\s*$/u, '')
    .trim();
}

/** Fenced TypeScript blocks with the documentation line their first code line sits on. */
function extractSnippets(docPath) {
  const lines = readFileSync(path.join(REPO_ROOT, docPath), 'utf8').split('\n');
  const snippets = [];
  let open = null;

  for (const [index, line] of lines.entries()) {
    const fence = /^```(\w*)\s*$/u.exec(line);

    if (open === null) {
      if (fence !== null) {
        const directive = directiveAbove(lines, index) ?? '';
        const optOut = OPT_OUT_PATTERN.exec(directive);
        const context = CONTEXT_PATTERN.exec(directive);
        open = {
          language: fence[1],
          startLine: index + 2,
          code: [],
          optOutReason: optOut === null ? null : optOut[1].trim(),
          context: context === null ? '' : context[1].trim(),
        };
      }
      continue;
    }

    if (fence !== null && fence[1] === '') {
      if (TYPESCRIPT_FENCE_LANGUAGES.has(open.language)) {
        snippets.push({
          docPath,
          startLine: open.startLine,
          code: open.code.join('\n'),
          optOutReason: open.optOutReason,
          context: open.context,
        });
      }
      open = null;
      continue;
    }

    open.code.push(line);
  }

  return snippets;
}

function documentSlug(docPath) {
  return docPath.replace(/\.md$/u, '').replace(/[^A-Za-z0-9]+/gu, '-');
}

/** Honor a leading `// path.ts` filename comment so cross-snippet imports resolve. */
function scratchPathFor(snippet) {
  const firstLine = snippet.code.split('\n').find((line) => line.trim().length > 0) ?? '';
  const declared = DECLARED_FILENAME_PATTERN.exec(firstLine.trim());
  const fileName = declared === null ? `snippet-L${snippet.startLine}.ts` : declared[1];
  return path.join(documentSlug(snippet.docPath), fileName);
}

/** A snippet with no import/export is a script, not a module; top-level await needs a module. */
function asModule(code) {
  return /^\s*(?:import|export)\b/mu.test(code) ? code : `${code}\nexport {};`;
}

function writeScratchProject(compiledSnippets) {
  rmSync(SCRATCH_DIR, { recursive: true, force: true });
  mkdirSync(SCRATCH_DIR, { recursive: true });
  writeFileSync(path.join(SCRATCH_DIR, 'tsconfig.json'), scratchTsconfig());
  writeFileSync(path.join(SCRATCH_DIR, 'ambient.d.ts'), AMBIENT_CONTEXT);

  const fileMap = new Map();
  for (const snippet of compiledSnippets) {
    const scratchPath = scratchPathFor(snippet);
    const absolutePath = path.join(SCRATCH_DIR, scratchPath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });

    const contextLines = snippet.context.length === 0 ? [] : snippet.context.split('\n');
    const body = `${contextLines.join('\n')}${contextLines.length === 0 ? '' : '\n'}${asModule(snippet.code)}\n`;
    writeFileSync(absolutePath, body);
    fileMap.set(scratchPath.split(path.sep).join('/'), {
      ...snippet,
      contextLineCount: contextLines.length,
    });
  }
  return fileMap;
}

/** Map a scratch-file diagnostic back to the documentation line that produced it. */
function toDocumentationFinding(fileMap, diagnostic) {
  const snippet = fileMap.get(diagnostic.fileName);
  if (snippet === undefined) {
    return { file: diagnostic.fileName, line: diagnostic.line, ...diagnostic.detail };
  }

  const snippetLine = diagnostic.line - snippet.contextLineCount;
  return snippetLine <= 0
    ? {
        file: snippet.docPath,
        line: snippet.startLine,
        code: diagnostic.detail.code,
        message: `snippet context directive: ${diagnostic.detail.message}`,
      }
    : {
        file: snippet.docPath,
        line: snippet.startLine + snippetLine - 1,
        code: diagnostic.detail.code,
        message: diagnostic.detail.message,
      };
}

function typecheckScratchProject() {
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--project',
      path.join(SCRATCH_DIR, 'tsconfig.json'),
      '--pretty',
      'false',
    ],
    { cwd: SCRATCH_DIR, encoding: 'utf8', timeout: TYPECHECK_TIMEOUT_MS },
  );

  if (result.error !== undefined) {
    throw result.error;
  }

  return `${result.stdout}${result.stderr}`.split('\n').flatMap((line) => {
    const match = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/u.exec(line.trim());
    return match === null
      ? []
      : [
          {
            fileName: match[1].split(path.sep).join('/'),
            line: Number(match[2]),
            detail: { code: match[4], message: match[5] },
          },
        ];
  });
}

function main() {
  const emitJson = process.argv.includes('--json');
  const snippets = SNIPPET_DOCS.flatMap((docPath) => extractSnippets(docPath));
  const optedOut = snippets.filter((snippet) => snippet.optOutReason !== null);
  const compiled = snippets.filter((snippet) => snippet.optOutReason === null);

  const fileMap = writeScratchProject(compiled);
  const findings = typecheckScratchProject().map((diagnostic) =>
    toDocumentationFinding(fileMap, diagnostic),
  );
  rmSync(SCRATCH_DIR, { recursive: true, force: true });

  const report = {
    totalSnippets: snippets.length,
    compiledSnippets: compiled.length,
    optOuts: optedOut.map((snippet) => ({
      file: snippet.docPath,
      line: snippet.startLine,
      reason: snippet.optOutReason,
    })),
    findings,
  };

  if (emitJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const finding of findings) {
      process.stdout.write(`${finding.file}:${finding.line} ${finding.code}: ${finding.message}\n`);
    }
    for (const optOut of report.optOuts) {
      process.stdout.write(`${optOut.file}:${optOut.line} [opt-out] ${optOut.reason}\n`);
    }
    process.stdout.write(
      `\nCompiled ${report.compiledSnippets}/${report.totalSnippets} documentation snippets: ` +
        `${findings.length} type error(s), ${report.optOuts.length} documented opt-out(s).\n`,
    );
  }

  process.exitCode = findings.length === 0 ? 0 : 1;
}

main();
