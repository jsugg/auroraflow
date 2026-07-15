import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expectInvariant,
  expectTextExcludes,
  expectTextIncludes,
  expectTextNotMatches,
} from '../../../helpers/contractAssertions';

const REPO_ROOT = process.cwd();

interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>;
}

const packageJson = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
) as PackageJson;
const scripts = packageJson.scripts ?? {};
const scriptNames = new Set(Object.keys(scripts));

/** Docs that instruct a reader to run repository commands. */
const COMMAND_REFERENCE_DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'docs/development.md',
  'docs/getting-started.md',
  'docs/operations/release-process.md',
] as const;

/** Docs whose publish-status wording derives from the canonical release-state section. */
const RELEASE_STATE_DERIVED_DOCS = [
  'README.md',
  'docs/api-stability.md',
  'docs/getting-started.md',
  'docs/architecture/traceability.md',
] as const;

/** Derived docs that mention publish status must point at the canonical section. */
const RELEASE_STATE_LINKING_DOCS = [
  'docs/api-stability.md',
  'docs/getting-started.md',
  'docs/architecture/traceability.md',
] as const;

const CANONICAL_RELEASE_STATE_DOC = 'docs/operations/release-process.md';
const CANONICAL_RELEASE_STATE_ANCHOR = 'release-process.md#current-state-dry-run-only';

/** Docs whose normative "the changelog" references must resolve to a durable file. */
const CHANGELOG_REFERENCING_DOCS = [
  'docs/api-stability.md',
  'docs/operations/release-process.md',
] as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function markdownLinkTargets(markdown: string): readonly string[] {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/gu)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function linkResolvesTo(fromDoc: string, target: string, expectedRepoPath: string): boolean {
  const [targetPath] = target.split('#');
  if (targetPath === undefined || targetPath.length === 0) {
    return false;
  }
  const resolved = path.resolve(path.dirname(path.join(REPO_ROOT, fromDoc)), targetPath);
  return resolved === path.join(REPO_ROOT, expectedRepoPath);
}

function referencedScriptNames(markdown: string): readonly string[] {
  return [...markdown.matchAll(/npm run ([A-Za-z0-9:_-]+)/gu)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function verifySteps(): readonly string[] {
  const verify = scripts.verify;
  if (verify === undefined) {
    throw new Error('Missing npm script: verify');
  }
  return verify.split(/\s+&&\s+/u).map((step) => step.trim());
}

describe('documentation consistency contract', () => {
  it('documents only npm scripts that exist in the manifest', () => {
    const references = COMMAND_REFERENCE_DOCS.flatMap((docPath) =>
      referencedScriptNames(readRepoFile(docPath)).map((scriptName) => ({ docPath, scriptName })),
    );

    expect(
      references.length,
      'Command-matrix guard must find documented `npm run` commands; an empty scan means the extractor stopped matching.',
    ).toBeGreaterThan(0);

    const unknownReferences = references
      .filter(({ scriptName }) => !scriptNames.has(scriptName))
      .map(({ docPath, scriptName }) => `${docPath}: npm run ${scriptName}`);

    expect(
      unknownReferences,
      'Documented `npm run` commands must exist in package.json scripts so contributor instructions stay executable.',
    ).toEqual([]);
  });

  it('keeps the documented verify composition equal to the executable verify script', () => {
    expectInvariant(
      !verifySteps().includes('npm run schemas:check'),
      'npm run verify still omits schemas:check. If schemas:check was added to verify, update this invariant and every doc describing schema validation as a separate gate in the same change.',
    );

    const developmentGuide = readRepoFile('docs/development.md');
    const releaseProcess = readRepoFile(CANONICAL_RELEASE_STATE_DOC);

    const verifyEnumeration = /`npm run verify` runs ([^.]*)\./u.exec(developmentGuide)?.[1];
    expectInvariant(
      verifyEnumeration !== undefined,
      'Development guide must enumerate what `npm run verify` runs so the enumeration stays checkable against package.json.',
    );
    expectTextNotMatches(verifyEnumeration ?? '', {
      pattern: /schema/iu,
      rationale:
        'Development guide must not list schema validation inside the `npm run verify` enumeration while verify omits schemas:check.',
    });

    for (const claim of ['even though it is part of `verify`', 'schema validation, ShellCheck']) {
      expectTextExcludes(`${developmentGuide}\n${releaseProcess}`, {
        text: claim,
        rationale:
          'Documented gate composition must equal executable composition: schemas:check runs as a separate CI/release evidence gate, outside `npm run verify`.',
      });
    }
  });

  it('keeps routine CI distinct from the release dry run that invokes verify', () => {
    expectTextExcludes(readRepoFile('docs/development.md'), {
      text: 'CI installs native `actionlint` before running `npm run verify`',
      rationale:
        'Routine CI runs verify components as individual Static Analysis steps; only the manual release dry run invokes `npm run verify` verbatim.',
    });
  });

  it('resolves "the changelog" to the durable root CHANGELOG.md', () => {
    expectTextIncludes(readRepoFile('CHANGELOG.md'), {
      text: '## [Unreleased]',
      rationale:
        'Changelog must keep an Unreleased section so entries have a durable home before the first published release.',
    });

    for (const docPath of CHANGELOG_REFERENCING_DOCS) {
      const linksToChangelog = markdownLinkTargets(readRepoFile(docPath)).some((target) =>
        linkResolvesTo(docPath, target, 'CHANGELOG.md'),
      );
      expectInvariant(
        linksToChangelog,
        `${docPath} makes normative "the changelog" promises, so it must link to the durable root CHANGELOG.md rather than leave the reference dangling or point only at the 30-day changelog-draft.md artifact.`,
      );
    }
  });

  it('derives publish status from the canonical release-state declaration', () => {
    const releaseProcess = readRepoFile(CANONICAL_RELEASE_STATE_DOC);

    expectTextIncludes(releaseProcess, {
      text: 'This section is the canonical release-state declaration for the repository',
      rationale:
        'Release process doc must keep the canonical release-state declaration that every other document links to.',
    });
    expectTextIncludes(releaseProcess, {
      text: 'The `auroraflow` package has not been published to the npm registry',
      rationale:
        'Canonical release-state section must state the pre-publish fact derived docs rely on; changing it at the first real publish must force those docs to be revisited in the same change.',
    });

    for (const docPath of RELEASE_STATE_DERIVED_DOCS) {
      expectTextExcludes(readRepoFile(docPath), {
        text: 'is published as a public npm library',
        rationale:
          'Publish-status claims must derive from the canonical release-state section; the auroraflow package is not published to the npm registry.',
      });
    }

    for (const docPath of RELEASE_STATE_LINKING_DOCS) {
      expectTextIncludes(readRepoFile(docPath), {
        text: CANONICAL_RELEASE_STATE_ANCHOR,
        rationale:
          'Docs that mention publish status must link to the canonical release-state section instead of restating it.',
      });
    }
  });
});
