import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ARTIFACT_FIXTURE_ROOT = path.join(process.cwd(), 'tests', 'fixtures', 'artifacts');

/** Reads a JSON artifact fixture without widening untrusted JSON. */
export async function readArtifactFixture(relativePath: string): Promise<unknown> {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes('..')) {
    throw new Error('Artifact fixture path must stay within tests/fixtures/artifacts.');
  }
  return JSON.parse(
    await readFile(path.join(ARTIFACT_FIXTURE_ROOT, relativePath), 'utf8'),
  ) as unknown;
}

/** Resolves an artifact fixture path for APIs that read files directly. */
export function artifactFixturePath(relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes('..')) {
    throw new Error('Artifact fixture path must stay within tests/fixtures/artifacts.');
  }
  return path.join(ARTIFACT_FIXTURE_ROOT, relativePath);
}
