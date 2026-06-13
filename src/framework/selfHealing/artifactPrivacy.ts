import { createHmac } from 'node:crypto';
import type { Page } from 'playwright';
import type { DomElementSummary, DomSnapshot } from './types';

type ScreenshotPrivacyPolicy =
  | {
      readonly mode: 'capture';
      readonly maskSelectors: readonly string[];
      readonly maskColor: string;
    }
  | {
      readonly mode: 'disable';
      readonly maskSelectors: readonly [];
      readonly maskColor: string;
    };

type DomTextPrivacyPolicy =
  | { readonly mode: 'capture' | 'redact' | 'disable' }
  | { readonly mode: 'hash'; readonly hashKey: string };

export type ArtifactPrivacyPreset = 'compatible' | 'sensitive' | 'custom';

export interface ArtifactPrivacyPolicy {
  readonly preset: ArtifactPrivacyPreset;
  readonly screenshot: ScreenshotPrivacyPolicy;
  readonly domText: DomTextPrivacyPolicy;
}

const TEXT_BEARING_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'placeholder',
  'title',
]);
const NO_MASK_SELECTORS: readonly [] = Object.freeze([]);

export const DEFAULT_ARTIFACT_PRIVACY_POLICY: ArtifactPrivacyPolicy = Object.freeze({
  preset: 'compatible',
  screenshot: Object.freeze({
    mode: 'capture',
    maskSelectors: NO_MASK_SELECTORS,
    maskColor: '#ff00ff',
  }),
  domText: Object.freeze({ mode: 'capture' }),
});

export const SENSITIVE_ARTIFACT_PRIVACY_POLICY: ArtifactPrivacyPolicy = Object.freeze({
  preset: 'sensitive',
  screenshot: Object.freeze({
    mode: 'disable',
    maskSelectors: NO_MASK_SELECTORS,
    maskColor: '#000000',
  }),
  domText: Object.freeze({ mode: 'disable' }),
});

type Environment = Readonly<Record<string, string | undefined>>;

function transformDomText(
  value: string | undefined,
  policy: DomTextPrivacyPolicy,
): string | undefined {
  if (value === undefined) {
    return value;
  }
  switch (policy.mode) {
    case 'capture':
      return value;
    case 'disable':
      return undefined;
    case 'redact':
      return '[redacted]';
    case 'hash':
      if (policy.hashKey.trim().length === 0) {
        throw new Error('Artifact DOM text hash policy requires a non-empty hashKey.');
      }
      return `hmac-sha256:${createHmac('sha256', policy.hashKey).update(value).digest('hex')}`;
  }
}

function transformDomAttributes(
  attributes: Readonly<Record<string, string>>,
  policy: DomTextPrivacyPolicy,
): Record<string, string> {
  const transformed: Record<string, string> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (!TEXT_BEARING_ATTRIBUTE_NAMES.has(name.toLowerCase())) {
      transformed[name] = value;
      continue;
    }
    const transformedValue = transformDomText(value, policy);
    if (transformedValue !== undefined) {
      transformed[name] = transformedValue;
    }
  }
  return transformed;
}

function transformDomElement(
  element: DomElementSummary,
  policy: DomTextPrivacyPolicy,
): DomElementSummary {
  return {
    ...element,
    attributes: transformDomAttributes(element.attributes, policy),
    accessibleName: transformDomText(element.accessibleName, policy),
    text: transformDomText(element.text, policy),
  };
}

/** Applies artifact-safe DOM text handling after browser capture and before candidate extraction. */
export function applyDomSnapshotPrivacy(
  snapshot: DomSnapshot,
  policy: ArtifactPrivacyPolicy,
): DomSnapshot {
  if (policy.domText.mode === 'capture') {
    return snapshot;
  }
  return {
    ...snapshot,
    elements: snapshot.elements.map((element) => transformDomElement(element, policy.domText)),
  };
}

/** Resolves the compatible default or sensitive preset without echoing invalid input. */
export function resolveArtifactPrivacyPolicy(
  env: Environment = process.env,
  onDiagnostic?: (diagnostic: string) => void,
): ArtifactPrivacyPolicy {
  const rawPreset = env.AURORAFLOW_ARTIFACT_PRIVACY_PRESET?.trim().toLowerCase();
  if (rawPreset === undefined || rawPreset === '' || rawPreset === 'compatible') {
    return DEFAULT_ARTIFACT_PRIVACY_POLICY;
  }
  if (rawPreset === 'sensitive') {
    return SENSITIVE_ARTIFACT_PRIVACY_POLICY;
  }
  onDiagnostic?.(
    'AURORAFLOW_ARTIFACT_PRIVACY_PRESET must be compatible or sensitive; using compatible.',
  );
  return DEFAULT_ARTIFACT_PRIVACY_POLICY;
}

/** Captures a failure screenshot when enabled and applies configured Playwright mask selectors. */
export async function captureFailureScreenshot(
  page: Page,
  path: string,
  policy: ArtifactPrivacyPolicy,
): Promise<boolean> {
  if (policy.screenshot.mode === 'disable') {
    return false;
  }
  const mask = policy.screenshot.maskSelectors.map((selector) => page.locator(selector));
  await page.screenshot({
    path,
    ...(mask.length > 0 ? { mask, maskColor: policy.screenshot.maskColor } : {}),
  });
  return true;
}
