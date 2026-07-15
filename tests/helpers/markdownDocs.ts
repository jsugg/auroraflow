import { readdirSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const MARKDOWN_LINK_PATTERN = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;

export interface MarkdownLink {
  /** Link text, or alt text when `isImage` is true. */
  readonly text: string;
  /** Raw link target exactly as authored, including any `#anchor`. */
  readonly target: string;
  readonly isImage: boolean;
}

/** Inline links and images in authoring order. Reference-style links are not used in this repository. */
export function markdownLinks(markdown: string): readonly MarkdownLink[] {
  return [...markdown.matchAll(MARKDOWN_LINK_PATTERN)].flatMap((match) => {
    const [, bang, text, target] = match;
    return text === undefined || target === undefined
      ? []
      : [{ text, target, isImage: bang === '!' }];
  });
}

/** True for absolute URLs (`https:`, `mailto:`) and protocol-relative targets. */
export function isExternalLink(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target);
}

/**
 * Repo-relative path a relative markdown link resolves to, or undefined when the target is
 * external or a same-document anchor rather than a file reference.
 */
export function resolveMarkdownLink(fromDocPath: string, target: string): string | undefined {
  if (isExternalLink(target) || target.startsWith('#')) {
    return undefined;
  }

  const [targetPath] = target.split('#');
  if (targetPath === undefined || targetPath.length === 0) {
    return undefined;
  }

  const absolute = path.resolve(path.dirname(path.join(REPO_ROOT, fromDocPath)), targetPath);
  return path.relative(REPO_ROOT, absolute);
}

/** Every `.md` file under a repo-relative directory, as repo-relative paths. */
export function listMarkdownFiles(relativeDir: string): readonly string[] {
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
