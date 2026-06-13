import ts from 'typescript';

export const STABILITY_TIERS = [
  'stable',
  'advanced',
  'experimental',
  'deprecated',
  'internal',
] as const;

export type StabilityTier = (typeof STABILITY_TIERS)[number];

export type RootExportKind = 'runtime' | 'type';

export interface RootExport {
  name: string;
  kind: RootExportKind;
  source: string;
}

export interface ClassifiedExport {
  name: string;
  kind: RootExportKind;
  tier: StabilityTier;
}

function isStabilityTier(value: string): value is StabilityTier {
  return (STABILITY_TIERS as readonly string[]).includes(value);
}

/**
 * Extracts the named exports of a package entrypoint in declaration order.
 *
 * Only named re-export declarations (`export { ... } from '...'` and
 * `export type { ... } from '...'`) are supported; `export *` would make the
 * root inventory open-ended, so it is rejected to keep the stability manifest
 * exhaustive.
 */
export function extractRootExports(sourceText: string, fileName = 'index.ts'): RootExport[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const rootExports: RootExport[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) {
      throw new Error(
        `Unsupported statement in ${fileName}: only named export declarations are supported ` +
          `by the API stability inventory (found '${statement.getText(sourceFile).slice(0, 80)}').`,
      );
    }

    const { exportClause, moduleSpecifier } = statement;
    if (!exportClause || !ts.isNamedExports(exportClause)) {
      throw new Error(
        `Unsupported 'export *' in ${fileName}: wildcard re-exports make the root export ` +
          'inventory open-ended; list every export explicitly.',
      );
    }

    const source =
      moduleSpecifier && ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : 'local';

    for (const element of exportClause.elements) {
      rootExports.push({
        name: element.name.text,
        kind: statement.isTypeOnly || element.isTypeOnly ? 'type' : 'runtime',
        source,
      });
    }
  }

  return rootExports;
}

/**
 * Parses the classification tables of `docs/api-stability.md`.
 *
 * A manifest row is any markdown table row whose first cell is a backticked
 * export name followed by a kind cell and a tier cell:
 * `| \`name\` | runtime | stable | ... |`. Rows with an unknown kind or tier
 * fail loudly instead of being skipped, so a typo cannot silently
 * unclassify an export.
 */
export function parseStabilityManifest(markdown: string): ClassifiedExport[] {
  const manifestRow = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/;
  const classified: ClassifiedExport[] = [];

  for (const line of markdown.split('\n')) {
    const match = manifestRow.exec(line);
    if (!match) {
      continue;
    }

    const [, name, kind, tier] = match;
    if (kind !== 'runtime' && kind !== 'type') {
      throw new Error(`Invalid export kind '${kind}' for manifest entry '${name}'.`);
    }
    if (!isStabilityTier(tier)) {
      throw new Error(
        `Invalid stability tier '${tier}' for manifest entry '${name}'; ` +
          `expected one of: ${STABILITY_TIERS.join(', ')}.`,
      );
    }

    classified.push({ name, kind, tier });
  }

  return classified;
}

export function findDuplicateNames(entries: readonly { name: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      duplicates.add(entry.name);
    }
    seen.add(entry.name);
  }
  return [...duplicates];
}
