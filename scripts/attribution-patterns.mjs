// Attribution patterns vendored byte-identically from the shared cross-repository source so
// GitHub rulesets, local agent hooks, and this repository agree on one definition. The strings
// are RE2- and Python-compatible; compileAttributionPattern translates their leading inline
// flag group into JavaScript RegExp flags. Do not edit them here without updating the source.

/** Tool name used as a ref namespace (for example `<tool>/...`), not as the subject of the work. */
export const REF_NAME =
  '(?i)^(?:refs/(?:heads|tags)/)?(?:(?:ai|agents?|assistants?|bots?|llm)[/._-])?(?:claude|anthropic|codex|openai|chatgpt|copilot)(?:/|\\n?$)';

/** Attribution trailers, footers, session links, vendor no-reply addresses, and tool-branch merges. */
export const COMMIT_MESSAGE =
  '(?im)(?:^[ \\t]*(?:co-authored-by|assisted-by|generated-by|ai-assisted-by)[ \\t]*:[^\\n]*(?:claude|anthropic|codex|openai|chatgpt|copilot|gemini|cursor|windsurf|devin|aider|cline))|(?:^[^a-z0-9\\n]{0,8}(?:generated|created|written|authored|produced|assisted)[ \\t]+(?:by|with|using|via)[ \\t]+(?:an?[ \\t]+|the[ \\t]+)?\\[?(?:claude|anthropic|codex|openai|chatgpt|copilot|gemini|cursor|windsurf|devin|aider|cline)(?:[^a-z0-9\\n-]|\\n?$))|(?:claude\\.ai/(?:code|share)|claude\\.com/claude-code|chatgpt\\.com/(?:codex|share))|(?:noreply@(?:anthropic|openai)\\.com)|(?:^merge pull request #[0-9]+ from [^ \\n]+/(?:claude|anthropic|codex|openai|chatgpt|copilot)/)';

/** Vendor-owned commit author or committer email domains. */
export const EMAIL = '(?i)@(?:anthropic|openai)\\.com\\n?$';

/** Labels may not contain the banned vendor or tool words anywhere. */
export const LABEL = '(?i)(?:claude|anthropic|codex|openai)';

const INLINE_FLAG_GROUP = /^\(\?([a-z]+)\)/;
const SUPPORTED_INLINE_FLAGS = new Set(['i', 'm']);

export function compileAttributionPattern(source) {
  const inlineFlags = INLINE_FLAG_GROUP.exec(source);
  const flags = inlineFlags?.[1] ?? '';
  for (const flag of flags) {
    if (!SUPPORTED_INLINE_FLAGS.has(flag)) {
      throw new Error(`Unsupported inline attribution pattern flag: ${flag}`);
    }
  }
  const body = inlineFlags === null ? source : source.slice(inlineFlags[0].length);
  return new RegExp(body, flags);
}

export const ATTRIBUTION_PATTERNS = Object.freeze({
  refName: compileAttributionPattern(REF_NAME),
  commitMessage: compileAttributionPattern(COMMIT_MESSAGE),
  email: compileAttributionPattern(EMAIL),
  label: compileAttributionPattern(LABEL),
});

/** Returns the matched attribution text for a field kind, or null when the value is clean. */
export function findAttribution(kind, value) {
  const pattern = ATTRIBUTION_PATTERNS[kind];
  if (pattern === undefined) {
    throw new Error(`Unknown attribution field kind: ${kind}`);
  }
  const match = pattern.exec(value);
  return match === null ? null : match[0];
}
