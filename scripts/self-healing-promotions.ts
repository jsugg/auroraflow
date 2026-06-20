import { cleanupExpiredSelfHealingRegistryRecords } from './self-healing-registry-cleanup';
import { createSelfHealingScriptStoreHandle } from './self-healing-script-store';
import { SelfHealingPromotionWorkflow } from '../src/framework/selfHealing/promotionWorkflow';

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

export async function runSelfHealingPromotions(argv = process.argv.slice(2)): Promise<number> {
  const { command, flags } = parseArgs(argv);
  const handle = createSelfHealingScriptStoreHandle();
  const namespace = readStringFlag(flags, 'namespace');

  try {
    if (command === 'cleanup') {
      const summary = await cleanupExpiredSelfHealingRegistryRecords({
        store: handle.store,
        activeNamespace: namespace,
        limit: readPositiveIntegerFlag(flags, 'limit', 1000),
      });
      console.log(JSON.stringify(summary, null, 2));
      return 0;
    }

    const workflow = new SelfHealingPromotionWorkflow({
      store: handle.store,
      activeNamespace: namespace,
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
      console.log(JSON.stringify(result, null, 2));
      return result.status === 'conflict' ? 2 : 0;
    }

    if (command === 'reject') {
      const result = await workflow.reject({
        ...identifier,
        reviewer: resolveReviewer(flags),
        reason: readStringFlag(flags, 'reason') ?? '',
      });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    const result = await workflow.rollback({
      ...identifier,
      reviewer: resolveReviewer(flags),
      reason: readStringFlag(flags, 'reason'),
    });
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
