#!/usr/bin/env node
// Deterministic, network-free documentation checks over the repository's Markdown.
//
// Blocking findings:
//   - relative link targets that do not exist on disk
//   - #anchors that match no heading in the target document
//   - links that reach into ignored paths (.local/, node_modules/, build output)
//   - images without alt text, skipped heading levels, and non-descriptive link text
//
// External http(s) links are collected and reported but never block: the contract
// suite is network-free by design, so link liveness is not a build-time concern.
//
// Usage: node scripts/docs-link-check.mjs [--json] [file...]
// With no file arguments the default documentation scope below is checked.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();

/** Documents the check owns. Anchors are resolved against any Markdown file, in scope or not. */
const SCOPE = {
  files: ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md'],
  directories: ['docs'],
  globbedReadmes: ['examples', 'observability'],
};

/** Links into these paths are broken for readers: they are gitignored, generated, or private. */
const IGNORED_LINK_PREFIXES = [
  '.local/',
  'node_modules/',
  'dist/',
  'coverage/',
  'test-results/',
  'test-reports/',
  '.cache/',
];

/** Link text that tells a reader nothing about the destination. */
const NON_DESCRIPTIVE_LINK_TEXT = new Set(['here', 'link', 'this', 'click here', 'this link']);

function listMarkdownFiles(relativeDir) {
  return readdirSync(path.join(REPO_ROOT, relativeDir), { withFileTypes: true }).flatMap(
    (entry) => {
      const entryRelativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        return listMarkdownFiles(entryRelativePath);
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [entryRelativePath] : [];
    },
  );
}

function documentsInScope() {
  const readmes = SCOPE.globbedReadmes.flatMap((dir) =>
    listMarkdownFiles(dir).filter((file) => path.basename(file) === 'README.md'),
  );
  const directoryDocs = SCOPE.directories.flatMap((dir) => listMarkdownFiles(dir));
  return [...new Set([...SCOPE.files, ...directoryDocs, ...readmes])].sort();
}

/**
 * Strip fenced code blocks so their contents are never parsed as headings or links,
 * preserving line numbering so findings keep pointing at the right line.
 */
function maskFencedCode(lines) {
  let fence = null;
  return lines.map((line) => {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fence === null && fenceMatch !== null) {
      fence = fenceMatch[1][0];
      return '';
    }
    if (fence !== null) {
      if (fenceMatch !== null && fenceMatch[1][0] === fence) {
        fence = null;
      }
      return '';
    }
    return line;
  });
}

/** Inline code may contain bracket syntax that is not a link. */
function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, '');
}

function headingTextOf(rawHeading) {
  return rawHeading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .trim();
}

/** GitHub's heading anchor algorithm, including its duplicate `-1`, `-2` suffixes. */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s/g, '-');
}

function parseHeadings(lines) {
  const seen = new Map();
  const headings = [];

  for (const [index, line] of lines.entries()) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match === null) {
      continue;
    }

    const level = match[1].length;
    const text = headingTextOf(match[2]);
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);

    headings.push({
      level,
      text,
      anchor: count === 0 ? base : `${base}-${count}`,
      line: index + 1,
    });
  }

  return headings;
}

function parseLinks(lines) {
  return lines.flatMap((line, index) =>
    [...stripInlineCode(line).matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(
      (match) => ({
        isImage: match[1] === '!',
        text: match[2],
        target: match[3],
        line: index + 1,
      }),
    ),
  );
}

function isExternal(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

const anchorCache = new Map();

function anchorsOf(repoRelativePath) {
  const cached = anchorCache.get(repoRelativePath);
  if (cached !== undefined) {
    return cached;
  }

  const lines = maskFencedCode(
    readFileSync(path.join(REPO_ROOT, repoRelativePath), 'utf8').split('\n'),
  );
  const anchors = new Set(parseHeadings(lines).map((heading) => heading.anchor));
  anchorCache.set(repoRelativePath, anchors);
  return anchors;
}

function existsAt(repoRelativePath) {
  try {
    statSync(path.join(REPO_ROOT, repoRelativePath));
    return true;
  } catch {
    return false;
  }
}

function checkDocument(docPath, findings, externalLinks) {
  const lines = maskFencedCode(readFileSync(path.join(REPO_ROOT, docPath), 'utf8').split('\n'));
  const headings = parseHeadings(lines);
  const selfAnchors = new Set(headings.map((heading) => heading.anchor));

  const report = (line, rule, message) => findings.push({ file: docPath, line, rule, message });

  let previousLevel = null;
  for (const heading of headings) {
    if (previousLevel !== null && heading.level > previousLevel + 1) {
      report(
        heading.line,
        'heading-skip',
        `Heading "${heading.text}" jumps from h${previousLevel} to h${heading.level}; screen-reader navigation relies on an unbroken outline.`,
      );
    }
    previousLevel = heading.level;
  }

  for (const link of parseLinks(lines)) {
    if (link.isImage && link.text.trim().length === 0) {
      report(link.line, 'image-alt', `Image ${link.target} has no alt text.`);
    }

    if (!link.isImage && NON_DESCRIPTIVE_LINK_TEXT.has(link.text.trim().toLowerCase())) {
      report(
        link.line,
        'link-text',
        `Link text "${link.text}" does not describe its destination (${link.target}).`,
      );
    }

    if (isExternal(link.target)) {
      externalLinks.push({ file: docPath, line: link.line, target: link.target });
      continue;
    }

    const [targetPath, anchor] = link.target.split('#');

    if (targetPath === undefined || targetPath.length === 0) {
      if (anchor !== undefined && anchor.length > 0 && !selfAnchors.has(anchor)) {
        report(link.line, 'anchor', `No heading in this document matches "#${anchor}".`);
      }
      continue;
    }

    const resolved = path.relative(
      REPO_ROOT,
      path.resolve(path.dirname(path.join(REPO_ROOT, docPath)), targetPath),
    );

    if (resolved.startsWith('..')) {
      report(
        link.line,
        'escapes-repo',
        `Link target ${link.target} resolves outside the repository.`,
      );
      continue;
    }

    const ignoredPrefix = IGNORED_LINK_PREFIXES.find((prefix) => `${resolved}/`.startsWith(prefix));
    if (ignoredPrefix !== undefined) {
      report(
        link.line,
        'ignored-path',
        `Link target ${link.target} points into ${ignoredPrefix}, which readers cannot access.`,
      );
      continue;
    }

    if (!existsAt(resolved)) {
      report(
        link.line,
        'missing-target',
        `Link target ${link.target} does not exist (${resolved}).`,
      );
      continue;
    }

    if (anchor !== undefined && anchor.length > 0 && resolved.endsWith('.md')) {
      if (!anchorsOf(resolved).has(anchor)) {
        report(link.line, 'anchor', `No heading in ${resolved} matches "#${anchor}".`);
      }
    }
  }
}

function main() {
  const emitJson = process.argv.includes('--json');
  const explicitPaths = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const documents = explicitPaths.length > 0 ? explicitPaths : documentsInScope();
  const findings = [];
  const externalLinks = [];

  for (const docPath of documents) {
    checkDocument(docPath, findings, externalLinks);
  }

  if (emitJson) {
    process.stdout.write(
      `${JSON.stringify({ checkedFiles: documents.length, findings, externalLinks }, null, 2)}\n`,
    );
  } else {
    for (const finding of findings) {
      process.stdout.write(
        `${finding.file}:${finding.line} [${finding.rule}] ${finding.message}\n`,
      );
    }
    process.stdout.write(
      `\nChecked ${documents.length} documents: ${findings.length} blocking finding(s), ` +
        `${externalLinks.length} external link(s) reported (not checked).\n`,
    );
  }

  process.exitCode = findings.length === 0 ? 0 : 1;
}

main();
