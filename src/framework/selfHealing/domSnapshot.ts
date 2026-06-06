import type { Page } from 'playwright';
import type { DomElementSummary, DomSnapshot, DomSnapshotSummary } from './types';

export interface DomSnapshotOptions {
  maxDomNodes: number;
  maxTextLength: number;
  allowedAttributes: readonly string[];
  currentUrl?: string;
  capturedAt?: string;
}

interface BrowserDomSnapshotInput {
  capturedAt: string;
  currentUrl?: string;
  maxDomNodes: number;
  maxTextLength: number;
  allowedAttributes: readonly string[];
}

interface BrowserStyle {
  display: string;
  visibility: string;
  opacity: string;
}

interface BrowserRect {
  width: number;
  height: number;
}

interface BrowserAttribute {
  name: string;
  value: string;
}

interface BrowserElement {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly id: string;
  readonly attributes: Iterable<BrowserAttribute>;
  readonly classList: Iterable<string>;
  readonly children: { readonly length: number };
  readonly parentElement: BrowserElement | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  closest(selector: string): BrowserElement | null;
  getBoundingClientRect(): BrowserRect;
}

interface BrowserDocument {
  readonly location?: { readonly href: string };
  querySelector(selector: string): BrowserElement | null;
  querySelectorAll(selector: string): Iterable<BrowserElement>;
  getElementById(id: string): BrowserElement | null;
}

interface BrowserRuntime {
  readonly document: BrowserDocument;
  readonly CSS?: {
    escape(value: string): string;
  };
  getComputedStyle(element: BrowserElement): BrowserStyle;
}

const SENSITIVE_ATTRIBUTE_PATTERN = /password|token|secret|key|authorization|cookie|session/i;

export function normalizeDomText(value: string, maxLength: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return collapsed.slice(0, maxLength).trimEnd();
}

export function normalizeAllowedAttributes(attributes: readonly string[]): string[] {
  return [
    ...new Set(attributes.map((attribute) => attribute.trim().toLowerCase()).filter(Boolean)),
  ];
}

export function redactDomAttributeValue({
  attributeName,
  attributeValue,
  tagName,
}: {
  attributeName: string;
  attributeValue: string;
  tagName: string;
}): string {
  const normalizedName = attributeName.toLowerCase();
  const normalizedTagName = tagName.toLowerCase();
  if (
    SENSITIVE_ATTRIBUTE_PATTERN.test(normalizedName) ||
    (normalizedName === 'value' && ['input', 'textarea', 'select'].includes(normalizedTagName))
  ) {
    return '[redacted]';
  }
  return attributeValue;
}

export function summarizeDomSnapshot(
  snapshot: DomSnapshot,
  artifactPath?: string,
): DomSnapshotSummary {
  return {
    schemaVersion: snapshot.schemaVersion,
    capturedAt: snapshot.capturedAt,
    url: snapshot.url,
    nodeCount: snapshot.nodeCount,
    truncated: snapshot.truncated,
    elementCount: snapshot.elements.length,
    artifactPath,
  };
}

export async function captureDomSnapshot(
  page: Page,
  options: DomSnapshotOptions,
): Promise<DomSnapshot> {
  const browserInput: BrowserDomSnapshotInput = {
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    currentUrl: options.currentUrl,
    maxDomNodes: Math.max(1, Math.floor(options.maxDomNodes)),
    maxTextLength: Math.max(1, Math.floor(options.maxTextLength)),
    allowedAttributes: normalizeAllowedAttributes(options.allowedAttributes),
  };

  return page.evaluate<DomSnapshot, BrowserDomSnapshotInput>((input) => {
    const runtime = globalThis as unknown as BrowserRuntime;
    const documentRef = runtime.document;
    const skippedTags = new Set(['script', 'style', 'noscript', 'template']);
    const cssEscape =
      runtime.CSS?.escape ?? ((value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
    const allowedAttributes = new Set(input.allowedAttributes);
    const elements: DomElementSummary[] = [];
    let scannedNodes = 0;
    let truncated = false;

    function normalizeText(value: string | null): string {
      if (!value) {
        return '';
      }
      const collapsed = value.replace(/\s+/g, ' ').trim();
      if (collapsed.length <= input.maxTextLength) {
        return collapsed;
      }
      truncated = true;
      return collapsed.slice(0, input.maxTextLength).trimEnd();
    }

    function redactAttributeValue({
      attributeName,
      attributeValue,
      tagName,
    }: {
      attributeName: string;
      attributeValue: string;
      tagName: string;
    }): string {
      if (
        /password|token|secret|key|authorization|cookie|session/i.test(attributeName) ||
        (attributeName === 'value' && ['input', 'textarea', 'select'].includes(tagName))
      ) {
        return '[redacted]';
      }
      return attributeValue;
    }

    function collectAttributes(element: BrowserElement, tagName: string): Record<string, string> {
      const attributes: Record<string, string> = {};
      for (const attribute of element.attributes) {
        const name = attribute.name.toLowerCase();
        if (!allowedAttributes.has(name)) {
          continue;
        }
        attributes[name] = redactAttributeValue({
          attributeName: name,
          attributeValue: normalizeText(attribute.value),
          tagName,
        });
      }
      return attributes;
    }

    function isVisible(element: BrowserElement): boolean {
      if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
        return false;
      }
      const style = runtime.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function inferRole(element: BrowserElement, tagName: string): string | undefined {
      const explicitRole = element.getAttribute('role')?.trim();
      if (explicitRole) {
        return explicitRole.toLowerCase();
      }
      if (tagName === 'button') {
        return 'button';
      }
      if (tagName === 'a' && element.getAttribute('href')) {
        return 'link';
      }
      if (tagName === 'textarea') {
        return 'textbox';
      }
      if (tagName === 'select') {
        return 'combobox';
      }
      if (tagName === 'input') {
        const type = element.getAttribute('type')?.toLowerCase() ?? 'text';
        if (['button', 'submit', 'reset'].includes(type)) {
          return 'button';
        }
        if (['checkbox', 'radio', 'searchbox', 'slider', 'spinbutton'].includes(type)) {
          return type === 'searchbox' ? 'textbox' : type;
        }
        return 'textbox';
      }
      if (tagName === 'main') {
        return 'main';
      }
      if (tagName === 'nav') {
        return 'navigation';
      }
      if (tagName === 'form') {
        return 'form';
      }
      return undefined;
    }

    function textFromReferencedIds(rawIds: string | null): string {
      if (!rawIds) {
        return '';
      }
      return rawIds
        .split(/\s+/)
        .map((id) => documentRef.getElementById(id))
        .filter((element): element is BrowserElement => element !== null)
        .map((element) => normalizeText(element.textContent))
        .filter(Boolean)
        .join(' ');
    }

    function labelTextFor(element: BrowserElement): string {
      const id = element.getAttribute('id');
      if (id) {
        const label = documentRef.querySelector(`label[for="${cssEscape(id)}"]`);
        const labelText = normalizeText(label?.textContent ?? null);
        if (labelText) {
          return labelText;
        }
      }
      const parentLabel = element.closest('label');
      return normalizeText(parentLabel?.textContent ?? null);
    }

    function accessibleNameFor(element: BrowserElement): string | undefined {
      const directName = normalizeText(element.getAttribute('aria-label'));
      if (directName) {
        return directName;
      }
      const labelledBy = textFromReferencedIds(element.getAttribute('aria-labelledby'));
      if (labelledBy) {
        return normalizeText(labelledBy);
      }
      const labelText = labelTextFor(element);
      if (labelText) {
        return labelText;
      }
      for (const attributeName of ['placeholder', 'title', 'alt']) {
        const attributeValue = normalizeText(element.getAttribute(attributeName));
        if (attributeValue) {
          return attributeValue;
        }
      }
      const text = normalizeText(element.textContent);
      return text || undefined;
    }

    function depthFor(element: BrowserElement): number {
      let depth = 0;
      let current = element.parentElement;
      while (current) {
        depth += 1;
        current = current.parentElement;
      }
      return depth;
    }

    function cssAttributeValue(value: string): string {
      return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function stableClassTokens(element: BrowserElement): string[] {
      return [...element.classList]
        .filter((token) => /^[a-zA-Z][a-zA-Z0-9_-]{1,40}$/.test(token))
        .filter((token) => !/[a-f0-9]{8,}/i.test(token))
        .sort()
        .slice(0, 2);
    }

    function cssTokenFor(element: BrowserElement): string {
      const tagName = element.tagName.toLowerCase();
      const id = element.getAttribute('id');
      if (id) {
        return `${tagName}#${cssEscape(id)}`;
      }

      const parts = [tagName];
      const name = element.getAttribute('name');
      if (name) {
        parts.push(`[name="${cssAttributeValue(name)}"]`);
      }
      const type = element.getAttribute('type');
      if (type) {
        parts.push(`[type="${cssAttributeValue(type)}"]`);
      }
      for (const classToken of stableClassTokens(element)) {
        parts.push(`.${cssEscape(classToken)}`);
      }
      return parts.join('');
    }

    function cssPathFor(element: BrowserElement): string | undefined {
      const tokens: string[] = [];
      let current: BrowserElement | null = element;
      while (current && tokens.length < 4) {
        const tagName = current.tagName.toLowerCase();
        if (tagName === 'html') {
          break;
        }
        tokens.unshift(cssTokenFor(current));
        if (current.getAttribute('id')) {
          break;
        }
        current = current.parentElement;
      }
      return tokens.length > 0 ? tokens.join(' > ') : undefined;
    }

    function landmarkFor(element: BrowserElement): string | undefined {
      const landmark = element.closest('main, nav, aside, header, footer, form, section, [role]');
      if (!landmark || landmark === element) {
        return undefined;
      }
      return landmark.getAttribute('role')?.toLowerCase() ?? landmark.tagName.toLowerCase();
    }

    function isEditable(element: BrowserElement, tagName: string, enabled: boolean): boolean {
      if (!enabled) {
        return false;
      }
      if (!['input', 'textarea'].includes(tagName)) {
        return false;
      }
      return !element.hasAttribute('readonly') && element.getAttribute('aria-readonly') !== 'true';
    }

    for (const element of documentRef.querySelectorAll('*')) {
      if (scannedNodes >= input.maxDomNodes) {
        truncated = true;
        break;
      }
      scannedNodes += 1;

      const tagName = element.tagName.toLowerCase();
      if (skippedTags.has(tagName) || !isVisible(element)) {
        continue;
      }

      const attributes = collectAttributes(element, tagName);
      const role = inferRole(element, tagName);
      const accessibleName = accessibleNameFor(element);
      const text = normalizeText(element.textContent);
      const enabled =
        !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true';
      const parentTagName = element.parentElement?.tagName.toLowerCase();

      elements.push({
        id: `dom-${elements.length + 1}`,
        tagName,
        attributes,
        role,
        accessibleName,
        text: text || undefined,
        visible: true,
        enabled,
        editable: isEditable(element, tagName, enabled),
        depth: depthFor(element),
        childCount: element.children.length,
        parentTagName,
        landmark: landmarkFor(element),
        cssPath: cssPathFor(element),
      });
    }

    return {
      schemaVersion: '1.0.0',
      capturedAt: input.capturedAt,
      url: input.currentUrl ?? documentRef.location?.href,
      nodeCount: scannedNodes,
      truncated,
      elements,
    };
  }, browserInput);
}
