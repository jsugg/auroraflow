import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ARTIFACT_PRIVACY_POLICY,
  SENSITIVE_ARTIFACT_PRIVACY_POLICY,
  applyDomSnapshotPrivacy,
  captureFailureScreenshot,
  resolveArtifactPrivacyPolicy,
  type ArtifactPrivacyPolicy,
} from '../../../../../src/framework/selfHealing/artifactPrivacy';
import { extractDomCandidateSeeds } from '../../../../../src/framework/selfHealing/domCandidateExtraction';
import {
  SYNTHETIC_SECRET,
  createSyntheticSecretDomSnapshot,
} from '../../../../fixtures/privacy/syntheticSecrets';

describe('artifact privacy policy', () => {
  it('keeps the current capture behavior as the compatible default', () => {
    expect(resolveArtifactPrivacyPolicy({})).toBe(DEFAULT_ARTIFACT_PRIVACY_POLICY);
    expect(DEFAULT_ARTIFACT_PRIVACY_POLICY).toMatchObject({
      preset: 'compatible',
      screenshot: { mode: 'capture', maskSelectors: [] },
      domText: { mode: 'capture' },
    });
  });

  it('resolves the sensitive preset and reports invalid values without echoing them', () => {
    expect(
      resolveArtifactPrivacyPolicy({
        AURORAFLOW_ARTIFACT_PRIVACY_PRESET: 'sensitive',
      }),
    ).toBe(SENSITIVE_ARTIFACT_PRIVACY_POLICY);

    const diagnostics: string[] = [];
    const invalidValue = 'do-not-echo-this-value';
    expect(
      resolveArtifactPrivacyPolicy(
        { AURORAFLOW_ARTIFACT_PRIVACY_PRESET: invalidValue },
        (diagnostic) => diagnostics.push(diagnostic),
      ),
    ).toBe(DEFAULT_ARTIFACT_PRIVACY_POLICY);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).not.toContain(invalidValue);
  });

  it('removes visible DOM text and text-bearing attributes in sensitive mode', () => {
    const snapshot = applyDomSnapshotPrivacy(
      createSyntheticSecretDomSnapshot(),
      SENSITIVE_ARTIFACT_PRIVACY_POLICY,
    );

    expect(JSON.stringify(snapshot)).not.toContain(SYNTHETIC_SECRET);
    expect(snapshot.elements[0]).toMatchObject({
      attributes: { 'data-testid': 'submit-private-form' },
      text: undefined,
      accessibleName: undefined,
    });
  });

  it('supports redacted and keyed-hash DOM text policies', () => {
    const basePolicy = DEFAULT_ARTIFACT_PRIVACY_POLICY;
    const redactedPolicy: ArtifactPrivacyPolicy = {
      ...basePolicy,
      preset: 'custom',
      domText: { mode: 'redact' },
    };
    const hashedPolicy: ArtifactPrivacyPolicy = {
      ...basePolicy,
      preset: 'custom',
      domText: { mode: 'hash', hashKey: 'synthetic-test-key' },
    };

    const redacted = applyDomSnapshotPrivacy(createSyntheticSecretDomSnapshot(), redactedPolicy);
    const hashed = applyDomSnapshotPrivacy(createSyntheticSecretDomSnapshot(), hashedPolicy);

    expect(JSON.stringify(redacted)).not.toContain(SYNTHETIC_SECRET);
    expect(redacted.elements[0]?.text).toBe('[redacted]');
    expect(JSON.stringify(hashed)).not.toContain(SYNTHETIC_SECRET);
    expect(hashed.elements[0]?.text).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(
      extractDomCandidateSeeds({ snapshot: redacted, actionType: 'click', maxTextLength: 120 }),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ strategy: expect.stringMatching(/ariaLabel|roleName|text/) }),
      ]),
    );
    expect(
      extractDomCandidateSeeds({ snapshot: hashed, actionType: 'click', maxTextLength: 120 }),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ strategy: expect.stringMatching(/ariaLabel|roleName|text/) }),
      ]),
    );
  });

  it('disables screenshots in sensitive mode and supports mask hooks for custom policies', async () => {
    const screenshot = vi.fn().mockResolvedValue(Buffer.from('image'));
    const locator = vi.fn((selector: string) => ({ selector }));
    const page = { locator, screenshot } as unknown as Page;

    await expect(
      captureFailureScreenshot(
        page,
        'test-results/screenshots/private.png',
        SENSITIVE_ARTIFACT_PRIVACY_POLICY,
      ),
    ).resolves.toBe(false);
    expect(screenshot).not.toHaveBeenCalled();

    const maskedPolicy: ArtifactPrivacyPolicy = {
      ...DEFAULT_ARTIFACT_PRIVACY_POLICY,
      preset: 'custom',
      screenshot: {
        mode: 'capture',
        maskSelectors: ['[data-private]', '.account-number'],
        maskColor: '#000000',
      },
    };
    await expect(
      captureFailureScreenshot(page, 'test-results/screenshots/masked.png', maskedPolicy),
    ).resolves.toBe(true);
    expect(locator).toHaveBeenCalledTimes(2);
    expect(screenshot).toHaveBeenCalledWith({
      path: 'test-results/screenshots/masked.png',
      mask: [{ selector: '[data-private]' }, { selector: '.account-number' }],
      maskColor: '#000000',
    });
  });
});
