export type SelfHealingMode = 'off' | 'suggest' | 'guarded';

export interface SelfHealingConfig {
  mode: SelfHealingMode;
  minConfidence: number;
}

export type SelfHealingActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'read'
  | 'wait'
  | 'screenshot'
  | 'close'
  | 'unknown';

export interface SelfHealingActionContext {
  type: SelfHealingActionType;
  target?: string;
  description: string;
}

export interface CapturedFailureError {
  name: string;
  message: string;
  stack?: string;
}

export interface CapturedFailureEvent {
  artifactVersion: '1.0.0';
  eventId: string;
  timestamp: string;
  mode: SelfHealingMode;
  minConfidence: number;
  pageObjectName: string;
  currentUrl?: string;
  screenshotPath?: string;
  action: SelfHealingActionContext;
  error: CapturedFailureError;
}
