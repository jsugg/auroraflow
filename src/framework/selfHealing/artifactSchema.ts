import type {
  CapturedFailureEvent,
  DomElementSummary,
  DomSnapshot,
  PendingSelectorPromotion,
  SelectorCandidateHistory,
} from './types';

export class SelfHealingArtifactSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfHealingArtifactSchemaError';
  }
}

function toRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SelfHealingArtifactSchemaError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SelfHealingArtifactSchemaError(`${path}.${key} must be a non-empty string.`);
  }
  return value;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new SelfHealingArtifactSchemaError(`${path}.${key} must be a string.`);
  }
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string, path: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new SelfHealingArtifactSchemaError(`${path}.${key} must be a boolean.`);
  }
  return value;
}

function readNumber(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SelfHealingArtifactSchemaError(`${path}.${key} must be a finite number.`);
  }
  return value;
}

function readNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const value = readNumber(record, key, path);
  if (!Number.isInteger(value) || value < 0) {
    throw new SelfHealingArtifactSchemaError(`${path}.${key} must be a non-negative integer.`);
  }
  return value;
}

function readStringRecord(
  record: Record<string, unknown>,
  key: string,
  path: string,
): Readonly<Record<string, string>> {
  const value = toRecord(record[key], `${path}.${key}`);
  const normalized: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== 'string') {
      throw new SelfHealingArtifactSchemaError(`${path}.${key}.${entryKey} must be a string.`);
    }
    normalized[entryKey] = entryValue;
  }
  return normalized;
}

function parseDomElement(rawElement: unknown, index: number): DomElementSummary {
  const path = `elements[${index}]`;
  const element = toRecord(rawElement, path);
  return {
    id: readString(element, 'id', path),
    tagName: readString(element, 'tagName', path),
    attributes: readStringRecord(element, 'attributes', path),
    role: readOptionalString(element, 'role', path),
    accessibleName: readOptionalString(element, 'accessibleName', path),
    text: readOptionalString(element, 'text', path),
    visible: readBoolean(element, 'visible', path),
    enabled: element.enabled === undefined ? undefined : readBoolean(element, 'enabled', path),
    editable: element.editable === undefined ? undefined : readBoolean(element, 'editable', path),
    depth: readNonNegativeInteger(element, 'depth', path),
    childCount: readNonNegativeInteger(element, 'childCount', path),
    parentTagName: readOptionalString(element, 'parentTagName', path),
    landmark: readOptionalString(element, 'landmark', path),
    cssPath: readOptionalString(element, 'cssPath', path),
  };
}

export function parseDomSnapshot(raw: unknown): DomSnapshot {
  const snapshot = toRecord(raw, 'snapshot');
  const schemaVersion = readString(snapshot, 'schemaVersion', 'snapshot');
  if (schemaVersion !== '1.0.0') {
    throw new SelfHealingArtifactSchemaError(
      `snapshot.schemaVersion must be 1.0.0. Received: ${schemaVersion}.`,
    );
  }

  if (!Array.isArray(snapshot.elements)) {
    throw new SelfHealingArtifactSchemaError('snapshot.elements must be an array.');
  }

  return {
    schemaVersion: '1.0.0',
    capturedAt: readString(snapshot, 'capturedAt', 'snapshot'),
    url: readOptionalString(snapshot, 'url', 'snapshot'),
    nodeCount: readNonNegativeInteger(snapshot, 'nodeCount', 'snapshot'),
    truncated: readBoolean(snapshot, 'truncated', 'snapshot'),
    elements: snapshot.elements.map((element, index) => parseDomElement(element, index)),
  };
}

export function parseSelectorCandidateHistory(raw: unknown): SelectorCandidateHistory {
  const history = toRecord(raw, 'history');
  return {
    candidateId: readString(history, 'candidateId', 'history'),
    attempts: readNonNegativeInteger(history, 'attempts', 'history'),
    validated: readNonNegativeInteger(history, 'validated', 'history'),
    guardedApplySucceeded: readNonNegativeInteger(history, 'guardedApplySucceeded', 'history'),
    guardedApplyFailed: readNonNegativeInteger(history, 'guardedApplyFailed', 'history'),
    promoted: readNonNegativeInteger(history, 'promoted', 'history'),
    rejected: readNonNegativeInteger(history, 'rejected', 'history'),
    lastSeenAt: readOptionalString(history, 'lastSeenAt', 'history'),
    lastSuccessAt: readOptionalString(history, 'lastSuccessAt', 'history'),
  };
}

export function parsePendingSelectorPromotion(raw: unknown): PendingSelectorPromotion {
  const promotion = toRecord(raw, 'promotion');
  return {
    eventId: readString(promotion, 'eventId', 'promotion'),
    candidateId: readString(promotion, 'candidateId', 'promotion'),
    selectorId: readString(promotion, 'selectorId', 'promotion'),
    locator: readString(promotion, 'locator', 'promotion'),
    requestedAt: readString(promotion, 'requestedAt', 'promotion'),
    acknowledged: readBoolean(promotion, 'acknowledged', 'promotion'),
  };
}

export function parseCapturedFailureEvent(raw: unknown): CapturedFailureEvent {
  const event = toRecord(raw, 'event');
  const artifactVersion = readString(event, 'artifactVersion', 'event');
  if (artifactVersion !== '1.0.0') {
    throw new SelfHealingArtifactSchemaError(
      `event.artifactVersion must be 1.0.0. Received: ${artifactVersion}.`,
    );
  }
  readString(event, 'eventId', 'event');
  readString(event, 'timestamp', 'event');
  readString(event, 'runId', 'event');
  readString(event, 'component', 'event');
  readString(event, 'errorCode', 'event');
  readString(event, 'mode', 'event');
  readNumber(event, 'minConfidence', 'event');
  toRecord(event.safetyPolicy, 'event.safetyPolicy');
  readString(event, 'pageObjectName', 'event');
  toRecord(event.action, 'event.action');
  toRecord(event.error, 'event.error');
  if (!Array.isArray(event.suggestions)) {
    throw new SelfHealingArtifactSchemaError('event.suggestions must be an array.');
  }
  return event as unknown as CapturedFailureEvent;
}
