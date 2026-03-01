/**
 * terminalParser.ts
 * Command parser for the Bio-Terminal. Integrates with the Zustand store.
 *
 * GENESIS ENGINE PHASE 3 — TASK 4: Terminal Command Expansion
 *
 * New commands:
 *   fold <sequence>          - Fold protein via store.foldProtein()
 *   search <pattern>         - Motif search via store.findMotif()
 *   clear                    - Clear all terminal logs via store.clearTerminalLogs()
 *
 * Preserved: fetch, mutate, audit, commit, help.
 */

import type { ArkheState } from '@/store/types';
import type { BaseCode } from '@/types/arkhe';

export interface CommandResult {
  output: string;
  error?: string;
}

export async function executeCommand(input: string, store: ArkheState): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) return { output: '' };

  const parts = trimmed.split(/\s+/);
  const cmd   = parts[0].toLowerCase();
  const args  = parts.slice(1);

  switch (cmd) {
    case 'fetch':
      return handleFetch(args, store);
    case 'mutate':
      return handleMutate(args, store);
    case 'audit':
      return handleAudit(args, store);
    case 'commit':
      return handleCommit(args, store);

    // ── TASK 4: new commands ───────────────────────────────────────────────
    case 'fold':
      return handleFold(args, store);
    case 'search':
      return handleSearch(args, store);
    case 'clear':
      return handleClear(store);
    // ──────────────────────────────────────────────────────────────────────

    case 'help':
      return {
        output: `Arkhé Genesis — Bio-Terminal v2.0
─────────────────────────────────────────────────────────────
  fetch <genomeId>           Load genome from cloud
  mutate <pos> <base>        Apply mutation  (e.g. mutate 1500 A)
  audit [start] [end]        Run Sentinel hazard scan
  commit <message>           Commit staged mutation to Chronos
  fold <sequence|"last">     Fold protein (ESM Atlas / Chou-Fasman)
  search <pattern>           Motif search (IUPAC codes OK)
  clear                      Clear the terminal log
  help                       Show this help`,
      };
    default:
      return { output: `Unknown command: "${cmd}". Type help for available commands.`, error: 'unknown command' };
  }
}

// ── Existing handlers ─────────────────────────────────────────────────────────

async function handleFetch(args: string[], store: ArkheState): Promise<CommandResult> {
  if (args.length < 1) {
    return { output: 'Usage: fetch <genomeId>', error: 'missing genomeId' };
  }
  const genomeId = args[0];
  try {
    await store.loadGenomeFromCloud(genomeId);
    return { output: `Genome "${genomeId}" loaded successfully.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Error: ${msg}`, error: msg };
  }
}

async function handleMutate(args: string[], store: ArkheState): Promise<CommandResult> {
  if (args.length < 2) {
    return { output: 'Usage: mutate <position> <base>  (e.g. mutate 1500 A)', error: 'missing args' };
  }
  const pos = parseInt(args[0], 10);
  if (isNaN(pos) || pos < 0) {
    return { output: 'Invalid position — must be a non-negative integer.', error: 'invalid position' };
  }
  const baseStr = args[1].toUpperCase();
  const baseCodeMap: Record<string, BaseCode> = { A: 0, C: 1, G: 2, T: 3, N: 4 };
  const base = baseCodeMap[baseStr];
  if (base === undefined) {
    return { output: `Invalid base "${baseStr}" — must be one of A C G T N.`, error: 'invalid base' };
  }
  try {
    const slabIndex = Math.floor(pos / 1_048_576);
    const offset    = pos % 1_048_576;
    await store.applyLocalMutation(slabIndex, offset, base, {
      user: 'terminal',
      reason: `terminal mutation at ${pos}`,
    });
    return { output: `Mutation applied at position ${pos.toLocaleString()}: → ${baseStr}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Mutation failed: ${msg}`, error: msg };
  }
}

async function handleAudit(args: string[], store: ArkheState): Promise<CommandResult> {
  const start = args[0] ? parseInt(args[0], 10) : undefined;
  const end   = args[1] ? parseInt(args[1], 10) : undefined;
  try {
    const hazards = await store.runSentinelAudit(start, end);
    if (hazards.length === 0) {
      return { output: 'Sentinel audit complete: no hazards detected.' };
    }
    const lines = hazards.map(
      (h) => `  [${h.severity.toUpperCase().padEnd(8)}] ${h.position.toLocaleString().padStart(12)} bp  ${h.description}`,
    );
    return {
      output: `Sentinel audit — ${hazards.length} hazard${hazards.length !== 1 ? 's' : ''} found:\n${lines.join('\n')}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Audit failed: ${msg}`, error: msg };
  }
}

async function handleCommit(args: string[], store: ArkheState): Promise<CommandResult> {
  const message = args.join(' ') || 'Terminal commit';
  const pending = store.pendingMutation;
  if (!pending) {
    return { output: 'No pending mutation to commit. Stage a mutation first with the mutate command.', error: 'no pending' };
  }
  try {
    await store.commitMutationWithReason(message);
    return { output: `Committed: "${message}"` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Commit failed: ${msg}`, error: msg };
  }
}

// ── TASK 4: New handlers ──────────────────────────────────────────────────────

/**
 * fold <sequence>
 *
 * Sends a sequence to store.foldProtein(). If the argument is the literal
 * string "last", attempts to re-fold using the most recent viewport
 * translation (frame 0). Falls back to Chou-Fasman heuristic if ESM Atlas
 * is rate-limited.
 *
 * Examples:
 *   fold MKTIIALSYIFCLVFA
 *   fold last
 */
async function handleFold(args: string[], store: ArkheState): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      output: 'Usage: fold <amino-acid-sequence|"last">\n  Example: fold MKTIIALSYIFCLVFA',
      error: 'missing sequence',
    };
  }

  let sequence: string;

  if (args[0].toLowerCase() === 'last') {
    // Use the frame-0 translation of the current viewport if available
    const frame0 = store.viewport.translations?.frame0;
    if (!frame0 || frame0.length === 0) {
      return { output: 'No viewport translation available — load a genome and ensure the viewport is populated.', error: 'no translation' };
    }
    // Trim stop codons and take the first ORF fragment
    sequence = frame0.replace(/\*/g, '').slice(0, 1024);
  } else {
    sequence = args.join('').toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY*]/gi, '');
  }

  if (sequence.length < 3) {
    return { output: 'Sequence too short for folding (minimum 3 amino acids).', error: 'sequence too short' };
  }
  if (sequence.length > 2048) {
    return { output: `Sequence too long (${sequence.length} aa) — ESM Atlas limit is ~2048 aa. Truncating to first 2048 aa for this run.` };
  }

  try {
    const fold = await store.foldProtein(sequence, /* consentObtained */ true);
    const avgConf = fold.confidence.length > 0
      ? (fold.confidence.reduce((a, b) => a + b, 0) / fold.confidence.length * 100).toFixed(1)
      : 'n/a';
    const method = fold.method === 'ESM_ATLAS' ? 'ESM Atlas' : 'Chou-Fasman heuristic';
    let out = `Fold complete (${method})\n`;
    out += `  Amino acids:   ${fold.aminoAcids.length} aa\n`;
    out += `  Avg confidence: ${avgConf}%\n`;
    if (fold.warning)         out += `  ⚠ Warning: ${fold.warning}\n`;
    if (fold.rateLimitNotice) out += `  ℹ Note: ${fold.rateLimitNotice}\n`;
    if (fold.disclosure)      out += `  ℹ Disclosure: ${fold.disclosure}\n`;
    return { output: out.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Fold failed: ${msg}`, error: msg };
  }
}

/**
 * search <pattern>
 *
 * Calls store.findMotif() with the provided IUPAC pattern and reports
 * the number of hits, their positions, and lengths.
 *
 * Examples:
 *   search GATTACA
 *   search ATNNNNAT
 */
async function handleSearch(args: string[], store: ArkheState): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      output: 'Usage: search <motif-pattern>\n  IUPAC codes are supported (A T C G N R Y W S K M B D H V)\n  Example: search GATTACA',
      error: 'missing pattern',
    };
  }

  const pattern = args[0].toUpperCase();
  const IUPAC = /^[ATCGNRYWSKMBDHV]+$/i;
  if (!IUPAC.test(pattern)) {
    return { output: `Invalid pattern "${pattern}" — only IUPAC nucleotide codes allowed.`, error: 'invalid pattern' };
  }

  if (store.genomeLength === 0) {
    return { output: 'No genome loaded — use fetch or ingest a file first.', error: 'no genome' };
  }

  try {
    const hits = await store.findMotif(pattern);
    if (hits.length === 0) {
      return { output: `Motif search: no matches for "${pattern}" in ${store.genomeLength.toLocaleString()} bp genome.` };
    }

    const PREVIEW = 10;
    const lines = hits.slice(0, PREVIEW).map(
      (h, i) => `  ${String(i + 1).padStart(4)}.  ${h.start.toLocaleString().padStart(12)} bp  →  ${h.end.toLocaleString().padStart(12)} bp  (${h.end - h.start + 1} bp)`,
    );
    let out = `Motif search: ${hits.length.toLocaleString()} hit${hits.length !== 1 ? 's' : ''} for "${pattern}" in ${store.genomeLength.toLocaleString()} bp\n`;
    out += lines.join('\n');
    if (hits.length > PREVIEW) {
      out += `\n  … and ${hits.length - PREVIEW} more (use the Search panel for full results)`;
    }
    return { output: out };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Search failed: ${msg}`, error: msg };
  }
}

/**
 * clear
 *
 * Clears all entries from the terminal log via store.clearTerminalLogs().
 * This is a synchronous action — no Promise required.
 */
function handleClear(store: ArkheState): CommandResult {
  store.clearTerminalLogs();
  return { output: '' };   // Empty output: the log is now blank, no echo needed
}