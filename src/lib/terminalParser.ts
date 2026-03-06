/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Command parser for the Bio-Terminal. Integrates with the Zustand store.
 *
 * ── SPRINT B CHANGES ─────────────────────────────────────────────────────────
 *
 *   TASK 2 — External Database Fetch via `fetch <id>`:
 *
 *   The `fetch` command is now a smart router:
 *
 *     1. detectIdType(id) classifies the argument as 'ncbi', 'uniprot', or
 *        'cloud'.
 *
 *     2. For 'ncbi' → fetchFromNCBI(id) hits the NCBI Entrez eFetch endpoint,
 *        creates a FASTA File, and calls store.loadFile() to stream the
 *        sequence into the ArkheEngine worker.
 *
 *     3. For 'uniprot' → fetchFromUniProt(id) hits the UniProt REST API,
 *        creates a FASTA File, and calls store.loadFile() identically.
 *
 *     4. For 'cloud' → the original store.loadGenomeFromCloud() path is
 *        preserved unchanged (no regression for existing users).
 *
 *     5. SourceTracker.set() is called on success so that Workbench.tsx can
 *        render the appropriate "Trust Badge" without Zustand store changes.
 *
 *   Updated help text reflects the new routing.
 *
 * ── GENESIS ENGINE PHASE 3 — TASK 4 (retained) ───────────────────────────────
 *   fold <sequence|"last">   — Fold protein via store.foldProtein()
 *   search <pattern>         — Motif search via store.findMotif()
 *   clear                    — Clear all terminal logs
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ArkheState } from '@/store/types';
import type { BaseCode }   from '@/types/arkhe';
import {
  detectIdType,
  fetchFromNCBI,
  fetchFromUniProt,
  sequenceToFastaFile,
  SourceTracker,
} from '@/lib/ExternalData';

export interface CommandResult {
  output: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Safety constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SPRINT 2 FIX (TASK 2) — Terminal "Input Bomb" Guard
 *
 * Pasting extremely large strings into the terminal was blocking the main
 * thread while split/regex operations processed millions of characters.
 *
 * Hard limit: 50,000 characters per command invocation. Any input exceeding
 * this threshold is rejected immediately without touching the parser or the
 * worker. A SystemLog error is emitted so the researcher knows what happened.
 */
const INPUT_CHAR_LIMIT = 50_000;

export async function executeCommand(
  input: string,
  store: ArkheState,
): Promise<CommandResult> {
  // ── SPRINT 2 FIX — Input bomb guard ──────────────────────────────────────
  if (input.length > INPUT_CHAR_LIMIT) {
    store.addSystemLog({
      timestamp: Date.now(),
      category : 'SYSTEM',
      message  : `❌ Input Error: Command arguments exceed safety buffer (50k limit).`,
      level    : 'error',
    });
    return {
      output: `Input Error: Command arguments exceed safety buffer (50k limit).`,
      error : 'input_too_large',
    };
  }

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

    // ── TASK 4: protein fold & motif search ───────────────────────────────
    case 'fold':
      return handleFold(args, store);
    case 'search':
      return handleSearch(args, store);
    case 'clear':
      return handleClear(store);
    // ──────────────────────────────────────────────────────────────────────

    case 'help':
      return { output: HELP_TEXT };

    default:
      return {
        output: `Unknown command: "${cmd}". Type help for available commands.`,
        error:  'unknown command',
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § Help text
// ─────────────────────────────────────────────────────────────────────────────

const HELP_TEXT = `Arkhé Genesis — Bio-Terminal v3.0
─────────────────────────────────────────────────────────────────────
  fetch <id>                 Smart-route fetch — routes by ID type:
                               NC_000913.3, AY123456 → NCBI Entrez
                               P69905, Q8I6T1        → UniProt REST
                               <uuid>               → Arkhé Cloud
  mutate <pos> <base>        Apply mutation  (e.g. mutate 1500 A)
  audit [start] [end]        Run Sentinel hazard scan
  commit <message>           Commit staged mutation to Chronos
  fold <sequence|"last">     Fold protein (ESM Atlas / Chou-Fasman)
  search <pattern>           Motif search (IUPAC codes OK)
  clear                      Clear the terminal log
  help                       Show this help
─────────────────────────────────────────────────────────────────────
Examples:
  fetch NC_000913.3          Load E. coli K-12 genome from NCBI
  fetch P69905               Load Human Haemoglobin A from UniProt
  fetch NC_000913.3          Load by RefSeq accession
  mutate 4500000 G           Mutate bp 4,500,000 to Guanine
  fold last                  Fold using current viewport frame-0`;

// ─────────────────────────────────────────────────────────────────────────────
// § fetch — smart ID router (SPRINT B TASK 2)
// ─────────────────────────────────────────────────────────────────────────────

async function handleFetch(
  args: string[],
  store: ArkheState,
): Promise<CommandResult> {
  if (args.length < 1) {
    return {
      output:
        'Usage: fetch <id>\n' +
        '  NCBI examples:   NC_000913.3  AY123456  NM_001234567\n' +
        '  UniProt examples: P69905  Q8I6T1  A0A000\n' +
        '  Arkhé Cloud:     pass your genome UUID',
      error: 'missing id',
    };
  }

  const id = args[0].trim();
  const idType = detectIdType(id);

  // ── Arkhé Cloud ──────────────────────────────────────────────────────────
  if (idType === 'cloud') {
    try {
      await store.loadGenomeFromCloud(id);
      SourceTracker.set({ type: 'file', id, label: id });
      return { output: `Genome "${id}" loaded from Arkhé Cloud.` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { output: `Error: ${msg}`, error: msg };
    }
  }

  // ── NCBI Entrez ──────────────────────────────────────────────────────────
  if (idType === 'ncbi') {
    return _fetchExternal({
      id,
      providerLabel: 'NCBI',
      fetchFn: () => fetchFromNCBI(id),
      buildResult: (r) => ({
        sequence: r.sequence,
        header: r.description,
        filename: `${r.accession}.fasta`,
        canonicalId: r.accession,
        summaryLines: [
          `  Accession : ${r.accession}`,
          `  Length    : ${r.length.toLocaleString()} bp`,
          `  Desc      : ${r.description.slice(0, 120)}${r.description.length > 120 ? '…' : ''}`,
        ],
        source: {
          type: 'ncbi' as const,
          id: r.accession,
          label: r.accession,
        },
      }),
      store,
    });
  }

  // ── UniProt ──────────────────────────────────────────────────────────────
  return _fetchExternal({
    id,
    providerLabel: 'UniProt',
    fetchFn: () => fetchFromUniProt(id),
    buildResult: (r) => ({
      sequence: r.sequence,
      header: `${r.id}|${r.name} OS=${r.organism}`,
      filename: `${r.id}.fasta`,
      canonicalId: r.id,
      summaryLines: [
        `  Accession : ${r.id}`,
        `  Protein   : ${r.name}`,
        `  Organism  : ${r.organism}`,
        `  Length    : ${r.length.toLocaleString()} aa`,
        ...(r.annotations.length > 0
          ? [`  Function  : ${r.annotations[0].description.slice(0, 100)}${r.annotations[0].description.length > 100 ? '…' : ''}`]
          : []),
      ],
      source: {
        type: 'uniprot' as const,
        id: r.id,
        label: r.id,
      },
    }),
    store,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — shared fetch + ingest flow for NCBI and UniProt
// ─────────────────────────────────────────────────────────────────────────────

interface FetchSpec<T> {
  id: string;
  providerLabel: string;
  fetchFn: () => Promise<T>;
  buildResult: (result: T) => {
    sequence: string;
    header: string;
    filename: string;
    canonicalId: string;
    summaryLines: string[];
    source: { type: 'ncbi' | 'uniprot'; id: string; label: string };
  };
  store: ArkheState;
}

async function _fetchExternal<T>({
  id,
  providerLabel,
  fetchFn,
  buildResult,
  store,
}: FetchSpec<T>): Promise<CommandResult> {
  // 1. Fetch from remote API
  let raw: T;
  try {
    raw = await fetchFn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `${providerLabel} fetch failed: ${msg}`, error: msg };
  }

  const { sequence, header, filename, canonicalId, summaryLines, source } =
    buildResult(raw);

  // 2. Ensure the worker is ready
  try {
    await store.initializeEngine();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      output: `Engine initialisation failed: ${msg}`,
      error: msg,
    };
  }

  // 3. Wrap the sequence as a FASTA File and stream it into the worker
  const fastaFile = sequenceToFastaFile(sequence, header, filename);

  try {
    await store.loadFile(fastaFile, canonicalId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      output: `Ingestion failed: ${msg}`,
      error: msg,
    };
  }

  // 4. Update the Trust Badge source tracker
  SourceTracker.set(source);

  // 5. Build user-facing summary
  const lines = [
    `✓ ${providerLabel} record loaded successfully`,
    ...summaryLines,
  ];
  return { output: lines.join('\n') };
}

// ─────────────────────────────────────────────────────────────────────────────
// § Existing handlers — unchanged
// ─────────────────────────────────────────────────────────────────────────────

async function handleMutate(
  args: string[],
  store: ArkheState,
): Promise<CommandResult> {
  if (args.length < 2) {
    return {
      output: 'Usage: mutate <position> <base>  (e.g. mutate 1500 A)',
      error: 'missing args',
    };
  }
  const pos = parseInt(args[0], 10);
  if (isNaN(pos) || pos < 0) {
    return {
      output: 'Invalid position — must be a non-negative integer.',
      error: 'invalid position',
    };
  }
  const baseStr = args[1].toUpperCase();
  const baseCodeMap: Record<string, BaseCode> = { A: 0, C: 1, G: 2, T: 3, N: 4 };
  const base = baseCodeMap[baseStr];
  if (base === undefined) {
    return {
      output: `Invalid base "${baseStr}" — must be one of A C G T N.`,
      error: 'invalid base',
    };
  }
  try {
    const slabIndex = Math.floor(pos / 1_048_576);
    const offset    = pos % 1_048_576;
    await store.applyLocalMutation(slabIndex, offset, base, {
      user: 'terminal',
      reason: `terminal mutation at ${pos}`,
    });
    // Mark the sequence as manually modified for Trust Badge
    SourceTracker.markMutated();
    return { output: `Mutation applied at position ${pos.toLocaleString()}: → ${baseStr}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Mutation failed: ${msg}`, error: msg };
  }
}

async function handleAudit(
  args: string[],
  store: ArkheState,
): Promise<CommandResult> {
  const start = args[0] ? parseInt(args[0], 10) : undefined;
  const end   = args[1] ? parseInt(args[1], 10) : undefined;
  try {
    const hazards = await store.runSentinelAudit(start, end);
    if (hazards.length === 0) {
      return { output: 'Sentinel audit complete: no hazards detected.' };
    }
    const lines = hazards.map(
      h =>
        `  [${h.severity.toUpperCase().padEnd(8)}] ` +
        `${h.position.toLocaleString().padStart(12)} bp  ${h.description}`,
    );
    return {
      output: `Sentinel audit — ${hazards.length} hazard${hazards.length !== 1 ? 's' : ''} found:\n${lines.join('\n')}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Audit failed: ${msg}`, error: msg };
  }
}

async function handleCommit(
  args: string[],
  store: ArkheState,
): Promise<CommandResult> {
  const message = args.join(' ') || 'Terminal commit';
  const pending = store.pendingMutation;
  if (!pending) {
    return {
      output: 'No pending mutation to commit. Stage a mutation first with the mutate command.',
      error: 'no pending',
    };
  }
  try {
    await store.commitMutationWithReason(message);
    return { output: `Committed: "${message}"` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Commit failed: ${msg}`, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § TASK 4: Protein folding handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * fold <sequence>
 *
 * Sends a sequence to store.foldProtein(). If the argument is the literal
 * string "last", re-folds using the current viewport frame-0 translation.
 * Falls back to Chou-Fasman heuristic if ESM Atlas is rate-limited.
 *
 * Examples:
 *   fold MKTIIALSYIFCLVFA
 *   fold last
 */
async function handleFold(
  args: string[],
  store: ArkheState,
): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      output: 'Usage: fold <amino-acid-sequence|"last">\n  Example: fold MKTIIALSYIFCLVFA',
      error: 'missing sequence',
    };
  }

  let sequence: string;

  if (args[0].toLowerCase() === 'last') {
    const frame0 = store.viewport.translations?.frame0;
    if (!frame0 || frame0.length === 0) {
      return {
        output:
          'No viewport translation available — load a genome and ensure the viewport is populated.',
        error: 'no translation',
      };
    }
    sequence = frame0.replace(/\*/g, '').slice(0, 1024);
  } else {
    sequence = args
      .join('')
      .toUpperCase()
      .replace(/[^ACDEFGHIKLMNPQRSTVWY*]/gi, '');
  }

  if (sequence.length < 3) {
    return {
      output: 'Sequence too short for folding (minimum 3 amino acids).',
      error: 'sequence too short',
    };
  }
  if (sequence.length > 2048) {
    return {
      output:
        `Sequence too long (${sequence.length} aa) — ESM Atlas limit is ~2048 aa. ` +
        `Truncating to first 2048 aa for this run.`,
    };
  }

  try {
    const fold = await store.foldProtein(sequence, /* consentObtained */ true);
    const avgConf =
      fold.confidence.length > 0
        ? (
            (fold.confidence.reduce((a, b) => a + b, 0) /
              fold.confidence.length) *
            100
          ).toFixed(1)
        : 'n/a';
    const method = fold.method === 'ESM_ATLAS' ? 'ESM Atlas' : 'Chou-Fasman heuristic';
    let out = `Fold complete (${method})\n`;
    out += `  Amino acids    : ${fold.aminoAcids.length} aa\n`;
    out += `  Avg confidence : ${avgConf}%\n`;
    if (fold.warning)         out += `  ⚠  Warning: ${fold.warning}\n`;
    if (fold.rateLimitNotice) out += `  ℹ  Note: ${fold.rateLimitNotice}\n`;
    if (fold.disclosure)      out += `  ℹ  Disclosure: ${fold.disclosure}\n`;
    return { output: out.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Fold failed: ${msg}`, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § TASK 4: Motif search handler
// ─────────────────────────────────────────────────────────────────────────────

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
async function handleSearch(
  args: string[],
  store: ArkheState,
): Promise<CommandResult> {
  if (args.length === 0) {
    return {
      output:
        'Usage: search <motif-pattern>\n' +
        '  IUPAC codes are supported (A T C G N R Y W S K M B D H V)\n' +
        '  Example: search GATTACA',
      error: 'missing pattern',
    };
  }

  const pattern = args[0].toUpperCase();
  const IUPAC   = /^[ATCGNRYWSKMBDHV]+$/i;
  if (!IUPAC.test(pattern)) {
    return {
      output: `Invalid pattern "${pattern}" — only IUPAC nucleotide codes allowed.`,
      error: 'invalid pattern',
    };
  }

  if (store.genomeLength === 0) {
    return {
      output: 'No genome loaded — use fetch or ingest a file first.',
      error: 'no genome',
    };
  }

  try {
    const hits = await store.findMotif(pattern);
    if (hits.length === 0) {
      return {
        output: `Motif search: no matches for "${pattern}" in ${store.genomeLength.toLocaleString()} bp genome.`,
      };
    }

    const PREVIEW = 10;
    const lines = hits.slice(0, PREVIEW).map(
      (h, i) =>
        `  ${String(i + 1).padStart(4)}.  ` +
        `${h.start.toLocaleString().padStart(12)} bp  →  ` +
        `${h.end.toLocaleString().padStart(12)} bp  ` +
        `(${h.end - h.start + 1} bp)`,
    );
    let out =
      `Motif search: ${hits.length.toLocaleString()} hit${hits.length !== 1 ? 's' : ''} ` +
      `for "${pattern}" in ${store.genomeLength.toLocaleString()} bp\n`;
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

// ─────────────────────────────────────────────────────────────────────────────
// § clear
// ─────────────────────────────────────────────────────────────────────────────

/**
 * clear
 *
 * Clears all entries from the terminal log via store.clearTerminalLogs().
 * Synchronous — no Promise required.
 */
function handleClear(store: ArkheState): CommandResult {
  store.clearTerminalLogs();
  return { output: '' };
}