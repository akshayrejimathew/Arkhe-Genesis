/**
 * terminalParser.ts
 * Command parser for the Bio-Terminal. Integrates with the Zustand store.
 */

import type { ArkheState } from '@/hooks/useArkheStore';
import type { BaseCode } from '@/types/arkhe';

export interface CommandResult {
  output: string;
  error?: string;
}

export async function executeCommand(input: string, store: ArkheState): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) return { output: '' };

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case 'fetch':
      return handleFetch(args, store);
    case 'mutate':
      return handleMutate(args, store);
    case 'audit':
      return handleAudit(args, store);
    case 'commit':
      return handleCommit(args, store);
    case 'help':
      return {
        output: `Available commands:
  fetch <genomeId>         - Load genome from cloud
  mutate <pos> <base>      - Apply mutation (e.g., mutate 1500 A)
  audit [start] [end]      - Run sentinel scan
  commit <message>         - Commit current changes
  help                      - Show this help`,
      };
    default:
      return { output: `Unknown command: ${cmd}`, error: 'unknown command' };
  }
}

async function handleFetch(args: string[], store: ArkheState): Promise<CommandResult> {
  if (args.length < 1) {
    return { output: 'Usage: fetch <genomeId>', error: 'missing genomeId' };
  }
  const genomeId = args[0];
  try {
    await store.loadGenomeFromCloud(genomeId);
    return { output: `Genome ${genomeId} loaded.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Error: ${msg}`, error: msg };
  }
}

async function handleMutate(args: string[], store: ArkheState): Promise<CommandResult> {
  if (args.length < 2) {
    return { output: 'Usage: mutate <position> <base>', error: 'missing args' };
  }
  const pos = parseInt(args[0], 10);
  if (isNaN(pos)) {
    return { output: 'Invalid position', error: 'invalid position' };
  }
  const baseStr = args[1].toUpperCase();
  // Map to BaseCode (0-4)
  const baseCodeMap: Record<string, BaseCode> = { A: 0, C: 1, G: 2, T: 3, N: 4 };
  const base = baseCodeMap[baseStr];
  if (base === undefined) {
    return { output: `Invalid base: ${baseStr}`, error: 'invalid base' };
  }
  try {
    const slabIndex = Math.floor(pos / 1_048_576);
    const offset = pos % 1_048_576;
    await store.applyLocalMutation(slabIndex, offset, base, {
      user: 'terminal',
      reason: 'terminal mutation',
    });
    return { output: `Mutation applied at ${pos}: → ${baseStr}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Mutation failed: ${msg}`, error: msg };
  }
}

async function handleAudit(args: string[], store: ArkheState): Promise<CommandResult> {
  const start = args[0] ? parseInt(args[0], 10) : undefined;
  const end = args[1] ? parseInt(args[1], 10) : undefined;
  try {
    const hazards = await store.runSentinelAudit(start, end);
    if (hazards.length === 0) {
      return { output: 'Sentinel scan complete: no hazards found.' };
    }
    const lines = hazards.map(
      (h) => `[${h.severity.toUpperCase()}] at ${h.position}: ${h.description}`
    );
    return { output: `Sentinel scan found ${hazards.length} hazards:\n` + lines.join('\n') };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Audit failed: ${msg}`, error: msg };
  }
}

async function handleCommit(args: string[], store: ArkheState): Promise<CommandResult> {
  const message = args.join(' ') || 'Terminal commit';
  const pending = store.pendingMutation;
  if (!pending) {
    return { output: 'No pending mutation to commit.', error: 'no pending' };
  }
  try {
    await store.commitMutationWithReason(message);
    return { output: `Committed: ${message}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Commit failed: ${msg}`, error: msg };
  }
}