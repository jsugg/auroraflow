import { existsSync } from 'node:fs';
import path from 'node:path';
import { cleanupExpiredSelfHealingRegistryRecords } from './self-healing-registry-cleanup';
import { createSelfHealingScriptStoreHandle } from './self-healing-script-store';
import {
  createPromotionAuthorizationPolicy,
  type PromotionAuthorizationMode,
  type PromotionAuthorizationPolicy,
} from '../src/framework/selfHealing/promotionAuthorization';
import {
  DEFAULT_PROMOTION_AUDIT_RETENTION_SECONDS,
  SelfHealingPromotionWorkflow,
} from '../src/framework/selfHealing/promotionWorkflow';

type CommandName = 'approve' | 'cleanup' | 'list' | 'reject' | 'rollback';

export interface ParsedArgs {
  command: CommandName;
  flags: Readonly<Record<string, string | boolean>>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command || !['approve', 'cleanup', 'list', 'reject', 'rollback'].includes(command)) {
    throw new Error(
      'Usage: self-healing-promotions <list|approve|reject|rollback|cleanup> [--flag value]',
    );
  }

  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }

  return { command: command as CommandName, flags };
}

function readStringFlag(
  flags: Readonly<Record<string, string | boolean>>,
  key: string,
): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

function readBooleanFlag(
  flags: Readonly<Record<string, string | boolean>>,
  key: string,
  defaultValue = false,
): boolean {
  const value = flags[key];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function readOptionalBooleanFlag(
  flags: Readonly<Record<string, string | boolean>>,
  key: string,
): boolean | undefined {
  return flags[key] === undefined ? undefined : readBooleanFlag(flags, key);
}

function readPositiveIntegerFlag(
  flags: Readonly<Record<string, string | boolean>>,
  key: string,
  defaultValue: number,
): number {
  const rawValue = readStringFlag(flags, key);
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive integer.`);
  }
  return parsed;
}

function resolveReviewer(flags: Readonly<Record<string, string | boolean>>): string {
  const reviewer = readStringFlag(flags, 'reviewer') ?? process.env.GITHUB_ACTOR;
  if (!reviewer?.trim()) {
    throw new Error('--reviewer is required when GITHUB_ACTOR is unset.');
  }
  return reviewer.trim();
}

function readPromotionAuthorizationMode(
  flags: Readonly<Record<string, string | boolean>>,
): PromotionAuthorizationMode {
  const rawMode =
    readStringFlag(flags, 'authorization-mode') ??
    process.env.SELF_HEAL_PROMOTION_AUTHORIZATION_MODE ??
    'local';
  if (rawMode === 'local' || rawMode === 'shared') {
    return rawMode;
  }
  throw new Error('--authorization-mode must be local or shared.');
}

function readEnvBoolean(name: string): boolean | undefined {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return undefined;
  }
  return ['1', 'true', 'yes', 'on'].includes(rawValue.trim().toLowerCase());
}

function resolveCodeownersPresent(flags: Readonly<Record<string, string | boolean>>): boolean {
  const flagOverride = readOptionalBooleanFlag(flags, 'codeowners-present');
  if (flagOverride !== undefined) {
    return flagOverride;
  }

  const configuredPath =
    readStringFlag(flags, 'codeowners-path') ??
    process.env.SELF_HEAL_PROMOTION_CODEOWNERS_PATH ??
    path.join(process.cwd(), '.github', 'CODEOWNERS');
  return existsSync(configuredPath);
}

function resolveProtectedWorkflow(flags: Readonly<Record<string, string | boolean>>): boolean {
  return (
    readOptionalBooleanFlag(flags, 'protected-workflow') ??
    readEnvBoolean('SELF_HEAL_PROMOTION_PROTECTED_WORKFLOW') ??
    readEnvBoolean('GITHUB_REF_PROTECTED') ??
    false
  );
}

function buildPromotionAuthorizationPolicy(
  flags: Readonly<Record<string, string | boolean>>,
): PromotionAuthorizationPolicy {
  const mode = readPromotionAuthorizationMode(flags);
  const codeownersPresent = resolveCodeownersPresent(flags);
  const protectedWorkflow = resolveProtectedWorkflow(flags);
  if (mode === 'shared' && (!codeownersPresent || !protectedWorkflow)) {
    throw new Error(
      'Shared promotion authorization requires CODEOWNERS and a protected workflow before mutating selectors.',
    );
  }
  return createPromotionAuthorizationPolicy({
    mode,
    codeownersPresent,
    protectedWorkflow,
  });
}

function writeAuthorizationWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) {
    console.error(`WARNING: ${warning}`);
  }
}

export async function runSelfHealingPromotions(argv = process.argv.slice(2)): Promise<number> {
  const { command, flags } = parseArgs(argv);
  const namespace = readStringFlag(flags, 'namespace');
  const authorizationPolicy =
    command === 'list' || command === 'cleanup'
      ? undefined
      : buildPromotionAuthorizationPolicy(flags);
  const handle = createSelfHealingScriptStoreHandle();

  try {
    if (command === 'cleanup') {
      const summary = await cleanupExpiredSelfHealingRegistryRecords({
        store: handle.store,
        activeNamespace: namespace,
        limit: readPositiveIntegerFlag(flags, 'limit', 1000),
        auditRetentionSeconds: readPositiveIntegerFlag(
          flags,
          'audit-retention-seconds',
          DEFAULT_PROMOTION_AUDIT_RETENTION_SECONDS,
        ),
        dryRun: !readBooleanFlag(flags, 'apply', false),
      });
      console.log(JSON.stringify(summary, null, 2));
      return 0;
    }

    const workflow = new SelfHealingPromotionWorkflow({
      store: handle.store,
      activeNamespace: namespace,
      authorizationPolicy,
    });

    if (command === 'list') {
      const result = await workflow.list({
        selectorId: readStringFlag(flags, 'selector-id'),
        candidateId: readStringFlag(flags, 'candidate-id'),
        includeAcknowledged: readBooleanFlag(flags, 'all', false),
        limit: readPositiveIntegerFlag(flags, 'limit', 100),
      });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    const identifier = {
      eventId: readStringFlag(flags, 'event-id'),
      promotionId: readStringFlag(flags, 'promotion-id'),
    };

    if (command === 'approve') {
      const result = await workflow.approve({
        ...identifier,
        reviewer: resolveReviewer(flags),
      });
      writeAuthorizationWarnings(result.authorizationWarnings);
      console.log(JSON.stringify(result, null, 2));
      return result.status === 'conflict' ? 2 : 0;
    }

    if (command === 'reject') {
      const result = await workflow.reject({
        ...identifier,
        reviewer: resolveReviewer(flags),
        reason: readStringFlag(flags, 'reason') ?? '',
      });
      writeAuthorizationWarnings(result.authorizationWarnings);
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    const result = await workflow.rollback({
      ...identifier,
      reviewer: resolveReviewer(flags),
      reason: readStringFlag(flags, 'reason'),
    });
    writeAuthorizationWarnings(result.authorizationWarnings);
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'conflict' ? 2 : 0;
  } finally {
    await handle.close().catch(() => {});
  }
}

if (require.main === module) {
  runSelfHealingPromotions().then(
    (exitCode) => {
      process.exit(exitCode);
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    },
  );
}
