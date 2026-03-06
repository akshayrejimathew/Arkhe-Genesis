/**
 * src/lib/sentinel/ScreeningEngine.ts
 * ============================================================================
 * ARKHÉ SENTINEL – Aho-Corasick Biosecurity Screening Engine
 * ============================================================================
 *
 * Scans a DNA sequence against a library of known pathogen signatures.
 * All patterns are fixed-length KMER_SIZE = 24 bases.
 *
 * ── SPRINT 2 RECTIFICATION PATCH LOG ────────────────────────────────────────
 *
 *   SEC-01 (CRITICAL) — Indestructible Aho-Corasick + N-base Bitmask NFA
 *
 *     PROBLEM (previous implementation):
 *       The engine used exact Map.has(kmerString) lookups. A single non-ACGT
 *       character (N, IUPAC ambiguity code) anywhere in a 24-mer produces a
 *       string that never matches a clean ACGT library entry — trivial evasion.
 *
 *       The interim fix added IUPAC expansion enumeration (4^n candidates) and
 *       a hard throw (CriticalSecurityError) when expansion count exceeded
 *       MAX_EXPANSION_SIZE. This created a DoS vector: an adversary could craft
 *       a sequence with ≥ 7 N-bases to halt the entire audit before completion.
 *
 *     FIX — Two-layer upgrade:
 *
 *       LAYER 1 – Aho-Corasick automaton replaces Map.has() k-mer lookups.
 *         buildFailureLinks() constructs the full BFS failure-link graph plus
 *         a precomputed goto table.  Every genome character transitions in O(1).
 *
 *       LAYER 2 – Bitmasked NFA simulation for IUPAC / N-base input.
 *         search() maintains a SET of active states. For each character the
 *         IUPAC bitmask determines which of {A,C,G,T} it could represent, and
 *         we follow all matching goto edges simultaneously. Active-state count
 *         is bounded by total trie nodes — never 4^n — so arbitrarily dense
 *         N-base sequences are handled in the same O(n) complexity class as
 *         clean ACGT input.
 *
 *   SEC-02 (MAINTAINED) — Dead RollingHash stub retained for API compat.
 *
 *   SEC-03 (MAINTAINED) — Dual-strand coverage.
 *     Both the forward signature and its RC are inserted into the trie at
 *     library-build time. No second pass over the sequence is needed.
 *
 *   SEC-04 (HARDENED) — Slab-Boundary Overlap.
 *     MAX_OVERLAP_BUFFER = 2 * KMER_SIZE = 48 bytes.
 *     Previously (KMER_SIZE - 1) = 23. The larger buffer prevents signatures
 *     from hiding at 1MB slab junctions by covering the full failure-link
 *     traversal range in both directions. The worker MUST import and use
 *     MAX_OVERLAP_BUFFER for inter-slab stitching.
 *
 * ── TASK 4 — Ambiguity DoS Defense ──────────────────────────────────────────
 *
 *   PROBLEM: Throwing CriticalSecurityError on high-ambiguity sequences
 *   halted the entire audit, allowing DoS via intentionally ambiguous input.
 *
 *   FIX: The NFA simulation handles all ambiguity levels natively.  When a
 *   sliding 24-mer window has an IUPAC expansion count > MAX_EXPANSION_SIZE,
 *   the engine emits a synthetic match with matchType: 'AMBIGUITY_OVERFLOW'
 *   and CONTINUES scanning.  No exception is thrown.
 *
 *   CriticalSecurityError is retained (exported) for API backwards compat but
 *   is no longer thrown by scan() or search() under normal operation.
 */

// ─── Custom error class ───────────────────────────────────────────────────────

/**
 * Retained for API backwards-compatibility.
 *
 * Previously thrown when IUPAC expansion exceeded MAX_EXPANSION_SIZE.
 * With the NFA engine, ambiguity overflow is reported via matchType
 * 'AMBIGUITY_OVERFLOW' and no exception is raised.
 */
export class CriticalSecurityError extends Error {
  readonly code = 'CRITICAL_SECURITY_ERROR' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CriticalSecurityError';
    Object.setPrototypeOf(this, CriticalSecurityError.prototype);
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ThreatMatch {
  /** 0-based absolute genome coordinate of the match. */
  position: number;
  /** Pathogen name from the signature library. */
  pathogen: string;
  /**
   * The raw k-mer from the input (may contain IUPAC ambiguity codes).
   * Preserved as-is for audit even for ambiguity-path matches.
   */
  sequence: string;
  /**
   * How this match was detected:
   *   'EXACT'              — Forward k-mer matched verbatim.
   *   'REVERSE_COMPLEMENT' — RC of k-mer matched.
   *   'POTENTIAL_MATCH'    — k-mer contained IUPAC bases; at least one ACGT
   *                          realisation matched. Requires manual review.
   *   'AMBIGUITY_OVERFLOW' — k-mer window IUPAC expansion count exceeded
   *                          MAX_EXPANSION_SIZE. Warning only; scan continued.
   *                          The NFA covers all expansion branches natively so
   *                          no false-negative is introduced.
   */
  matchType: 'EXACT' | 'REVERSE_COMPLEMENT' | 'POTENTIAL_MATCH' | 'AMBIGUITY_OVERFLOW';
  /**
   * For POTENTIAL_MATCH: the specific ACGT expansion that matched.
   * Undefined for all other matchType values.
   */
  matchedExpansion?: string;
}

export interface SignatureLibrary {
  version: string;
  /** key: 24-mer ACGT string (uppercase); value: pathogen name. */
  signatures: Map<string, string>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** K-mer window length. Must match the value in ArkheEngine.worker.ts. */
export const KMER_SIZE = 24;

/**
 * Maximum IUPAC expansion count before an AMBIGUITY_OVERFLOW entry is emitted.
 * With the NFA engine this is a monitoring threshold only — the scan never
 * stops or throws when this limit is exceeded.
 * 2^12 = 4096 ≈ 6 fully-ambiguous (N) positions per 24-mer.
 */
export const MAX_EXPANSION_SIZE = 4096;

/**
 * Required inter-slab overlap buffer size (bytes).
 *
 * Sprint 2 hardening: increased from (KMER_SIZE-1) = 23 to
 * 2 * KMER_SIZE = 48.  The extra coverage ensures that AC failure-link
 * traversal cannot cause a signature to hide at a 1 MB slab junction.
 *
 * ArkheEngine.worker.ts MUST import and use this constant when stitching
 * adjacent slabs before calling screenThreats().
 */
export const MAX_OVERLAP_BUFFER = 2 * KMER_SIZE; // 48 bytes

// ─── Internal Aho-Corasick types ─────────────────────────────────────────────

/** Base index encoding: A=0, C=1, G=2, T=3. */
type Base = 0 | 1 | 2 | 3;

const BASE_CHARS = ['A', 'C', 'G', 'T'] as const;

/** Maps single-char strings to their Base index (A/C/G/T + U alias). */
const BASE_IDX: Partial<Record<string, Base>> = { A: 0, C: 1, G: 2, T: 3, U: 3 };

/**
 * IUPAC ambiguity code → array of matching Base indices (A=0, C=1, G=2, T=3).
 * Drives the NFA bitmask expansion during search.
 * @see https://www.bioinformatics.org/sms/iupac.html
 */
const IUPAC_BASES: Readonly<Record<string, readonly Base[]>> = {
  A: [0], C: [1], G: [2], T: [3], U: [3],
  N: [0, 1, 2, 3],
  R: [0, 2],        // puRine        (A, G)
  Y: [1, 3],        // pYrimidine    (C, T)
  S: [1, 2],        // Strong        (C, G)
  W: [0, 3],        // Weak          (A, T)
  K: [2, 3],        // Keto          (G, T)
  M: [0, 1],        // aMino         (A, C)
  B: [1, 2, 3],     // not A         (C, G, T)
  D: [0, 2, 3],     // not C         (A, G, T)
  H: [0, 1, 3],     // not G         (A, C, T)
  V: [0, 1, 2],     // not T         (A, C, G)
};

/**
 * Per-character expansion multiplier for the AMBIGUITY_OVERFLOW check.
 * IUPAC_MULT[ch] = number of ACGT bases ch could represent.
 */
const IUPAC_MULT: Record<string, number> = {};
for (const [k, v] of Object.entries(IUPAC_BASES)) {
  IUPAC_MULT[k] = v.length;
}

/** IUPAC complement map used for reverse-complement computation. */
const IUPAC_COMP: Record<string, string> = {
  A: 'T', T: 'A', C: 'G', G: 'C',
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', D: 'H', H: 'D', V: 'B', N: 'N', U: 'A',
};

/** Internal per-node output record. */
interface ACOutput {
  kmer: string;
  pathogen: string;
  mt: 'EXACT' | 'REVERSE_COMPLEMENT';
}

/**
 * Aho-Corasick trie node.
 *
 *   ch  — four direct children (A, C, G, T), null for absent edges.
 *   f   — failure (suffix) link; null before buildFailureLinks().
 *   g   — precomputed goto table; g[b] = O(1) next-state on base b.
 *          Always non-null after buildFailureLinks() completes.
 *   out — accumulated outputs (own patterns + failure-chain patterns).
 *          Only non-empty at depth KMER_SIZE for our fixed-length library.
 */
interface ACNode {
  ch:  [ACNode | null, ACNode | null, ACNode | null, ACNode | null];
  f:   ACNode | null;
  g:   [ACNode | null, ACNode | null, ACNode | null, ACNode | null];
  out: ACOutput[];
}

function makeNode(): ACNode {
  return {
    ch:  [null, null, null, null],
    f:   null,
    g:   [null, null, null, null],
    out: [],
  };
}

// ─── Module-level utilities ───────────────────────────────────────────────────

/** Reverse complement of a DNA string (ACGT + IUPAC). */
function rcSeq(seq: string): string {
  let rc = '';
  for (let i = seq.length - 1; i >= 0; i--) {
    rc += IUPAC_COMP[seq[i]] ?? seq[i];
  }
  return rc;
}

/**
 * Estimate the IUPAC expansion count of the KMER_SIZE characters starting at
 * `offset` in `seq`.  Returns early once count exceeds MAX_EXPANSION_SIZE.
 * O(KMER_SIZE) per call; skipped for clean ACGT windows.
 */
function expansionCount(seq: string, offset: number): number {
  let count = 1;
  const end = Math.min(seq.length, offset + KMER_SIZE);
  for (let i = offset; i < end; i++) {
    count *= (IUPAC_MULT[seq[i]] ?? 4);
    if (count > MAX_EXPANSION_SIZE) return count;
  }
  return count;
}

// ─── RollingHash (SEC-02: API-compat stub) ────────────────────────────────────

/**
 * Rolling polynomial hash — retained for API backwards-compatibility only.
 *
 * SEC-02: This class is NOT called by the Aho-Corasick scan loop.  All
 * lookups now use the O(1) goto table.  A future optimisation may reintroduce
 * a hash pre-filter, but it would require a two-level verification step
 * (hash match → string equality confirm) to be correct.
 */
export class RollingHash {
  private hash = 0;
  private readonly base = 4;
  private readonly mod  = 2 ** 31 - 1;
  private readonly basePow: number;

  constructor() {
    this.basePow = 1;
    for (let i = 0; i < KMER_SIZE - 1; i++) {
      this.basePow = (this.basePow * this.base) % this.mod;
    }
  }

  private charVal(ch: string): number {
    switch (ch.toUpperCase()) {
      case 'A': return 0; case 'C': return 1;
      case 'G': return 2; case 'T': return 3;
      default:  return 0;
    }
  }

  init(seq: string): number {
    this.hash = 0;
    for (let i = 0; i < KMER_SIZE && i < seq.length; i++) {
      this.hash = (this.hash * this.base + this.charVal(seq[i])) % this.mod;
    }
    return this.hash;
  }

  update(prevChar: string, nextChar: string): number {
    const pv = this.charVal(prevChar);
    const nv = this.charVal(nextChar);
    this.hash = ((this.hash - pv * this.basePow) % this.mod + this.mod) % this.mod;
    this.hash = (this.hash * this.base + nv) % this.mod;
    return this.hash;
  }
}

// ─── ScreeningEngine ──────────────────────────────────────────────────────────

export class ScreeningEngine {
  private library : SignatureLibrary | null = null;
  private acRoot  : ACNode | null = null;
  private acReady = false;

  // ── Library management ────────────────────────────────────────────────────

  /**
   * Load a signature library and build the Aho-Corasick automaton.
   *
   * 1. Inserts every forward signature into the trie.
   * 2. Inserts the reverse complement of every signature (SEC-03 dual-strand).
   * 3. Calls buildFailureLinks() to wire the failure graph and goto table.
   *
   * After this method returns, isLoaded() returns true and search() / scan()
   * are ready to use.
   */
  loadLibrary(lib: SignatureLibrary): void {
    this.library = lib;
    this.acRoot  = makeNode();
    this.acReady = false;

    for (const [kmer, pathogen] of lib.signatures) {
      const fwd = kmer.toUpperCase();
      this.insertPattern(fwd, pathogen, 'EXACT');

      // SEC-03: Insert RC for dual-strand coverage in a single forward pass.
      const rc = rcSeq(fwd);
      if (rc !== fwd) {
        this.insertPattern(rc, pathogen, 'REVERSE_COMPLEMENT');
      }
    }

    this.buildFailureLinks();
  }

  isLoaded(): boolean  { return this.library !== null && this.acReady; }
  getVersion(): string | null { return this.library?.version ?? null; }

  // ── Trie construction ─────────────────────────────────────────────────────

  private insertPattern(
    pattern  : string,
    pathogen : string,
    mt       : 'EXACT' | 'REVERSE_COMPLEMENT',
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let node = this.acRoot!;

    for (const ch of pattern) {
      const idx = BASE_IDX[ch];
      if (idx === undefined) continue;  // skip non-ACGT (library guard)
      if (!node.ch[idx]) node.ch[idx] = makeNode();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      node = node.ch[idx]!;
    }

    node.out.push({ kmer: pattern, pathogen, mt });
  }

  // ── Failure link construction (BFS) ──────────────────────────────────────

  /**
   * Wire up Aho-Corasick failure links and precompute the goto table.
   *
   * Algorithm (Aho & Corasick, 1975):
   *
   *   Phase 1 — Root initialisation:
   *     root.failure = root.  Each depth-1 child c of root: c.failure = root.
   *     root.goto[b] = root.ch[b] ?? root  (self-loop for missing depth-1 edges).
   *
   *   Phase 2 — BFS over all other nodes u:
   *     For each child v = u.ch[b]:
   *       1. Walk u's failure chain until reaching a node with a goto on b:
   *            fail = u.failure
   *            while fail ≠ root and fail.goto[b] is unset: fail = fail.failure
   *       2. v.failure = fail.goto[b] (or root if that equals v — depth-1 edge).
   *       3. Merge v.failure.out into v.out (output function extension).
   *     For each base b (regardless of child existence):
   *       u.goto[b] = u.ch[b] ?? u.failure.goto[b]
   *     This is valid because failure.goto[b] is already set (BFS order).
   *
   * After completion every node's g[] array is fully populated, enabling
   * O(1) transitions in search() without any runtime failure-link chasing.
   *
   * Public so callers can rebuild the automaton after incremental insertions
   * without calling the full loadLibrary() path.
   */
  buildFailureLinks(): void {
    if (!this.acRoot) {
      throw new CriticalSecurityError(
        'buildFailureLinks: trie not initialised — call loadLibrary() first.',
      );
    }

    const root  = this.acRoot;
    root.f      = root;  // root's failure is itself

    const queue: ACNode[] = [];

    // ── Phase 1: depth-1 nodes ────────────────────────────────────────────
    for (let b = 0 as Base; b < 4; b++) {
      const child = root.ch[b];
      if (child) {
        child.f    = root;
        root.g[b]  = child;
        queue.push(child);
      } else {
        root.g[b] = root;   // self-loop: no pattern begins with this base
      }
    }

    // ── Phase 2: BFS ──────────────────────────────────────────────────────
    while (queue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const u = queue.shift()!;

      for (let b = 0 as Base; b < 4; b++) {
        const v = u.ch[b];

        if (v) {
          // ── Compute v.failure ─────────────────────────────────────────
          // Walk the failure chain of u to find the longest proper suffix
          // of u's path that has a goto on base b.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          let fail = u.f!;

          // Loop invariant: root.g[b] is always non-null (set in Phase 1),
          // so this loop terminates at or before reaching root.
          while (fail !== root && !fail.g[b]) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            fail = fail.f!;
          }

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const failDest = fail.g[b]!;
          // Guard: a depth-1 node must not point to itself via failure.
          v.f = (failDest !== v) ? failDest : root;

          // ── Merge failure outputs (output function extension) ─────────
          // Append any patterns that end at the failure node (i.e., shorter
          // patterns that are proper suffixes of v's path).
          // For our fixed-length 24-mer library this merge never adds entries
          // to non-terminal nodes, but is included for general correctness.
          if (v.f.out.length > 0) {
            v.out = [...v.out, ...v.f.out];
          }

          queue.push(v);
        }

        // ── Precompute goto for u on base b ────────────────────────────
        // Because u.f is already resolved (u was processed before its children)
        // and u.f.g[b] is already set (BFS ordering ensures failure nodes are
        // processed before their parent's children in the goto computation),
        // this assignment is always valid.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        u.g[b] = v ?? (u.f!.g[b] ?? root);
      }
    }

    this.acReady = true;
  }

  // ── Core NFA-based search ─────────────────────────────────────────────────

  /**
   * Aho-Corasick search with IUPAC bitmask NFA simulation.
   *
   * Algorithm:
   *   activeStates ← {root}
   *   for i = 0 … len-1:
   *     bases ← IUPAC_BASES[seq[i]]   // which ACGT bases this char represents
   *     nextStates ← ∅
   *     for each s in activeStates:
   *       for each b in bases:
   *         ns ← s.g[b]               // O(1) precomputed goto
   *         nextStates.add(ns)
   *         for each output o in ns.out:
   *           emit ThreatMatch at (i - KMER_SIZE + 1)
   *     activeStates ← nextStates (or {root} if empty)
   *     if ambig_window_expansion_count > MAX_EXPANSION_SIZE:
   *       emit AMBIGUITY_OVERFLOW at (i - KMER_SIZE + 1)  // warning only
   *
   * Complexity: O(n × |bases| × |activeStates|)
   *   |bases| ≤ 4, |activeStates| ≤ total trie nodes.
   *   Never exponential — no strings are enumerated.
   *
   * Deduplication: each (position, pathogen, matchType) triple is emitted at
   * most once even when multiple NFA paths converge on the same terminal node.
   *
   * @param seq          Input sequence (should be uppercased by the caller).
   * @param globalStart  Absolute genome offset of seq[0].
   * @returns            ThreatMatch array sorted ascending by position.
   */
  search(seq: string, globalStart = 0): ThreatMatch[] {
    if (!this.acRoot || !this.acReady) {
      throw new CriticalSecurityError(
        'ScreeningEngine.search: automaton not built — call loadLibrary() first.',
      );
    }

    const root   = this.acRoot;
    const len    = seq.length;
    const result : ThreatMatch[] = [];

    // Dedup set: "absPosition|pathogen|matchType"
    const seen = new Set<string>();

    // Active NFA state set — initialised to {root}.
    let active = new Set<ACNode>([root]);

    // ── Sliding window ambiguity tracking ────────────────────────────────
    // Ring buffer of KMER_SIZE boolean flags indicating whether each position
    // in the current window is an ambiguous (non-ACGT) character.
    // Used to (a) determine matchType (POTENTIAL_MATCH vs EXACT/RC) and
    // (b) gate the AMBIGUITY_OVERFLOW expansion check.
    const ambigRing = new Uint8Array(KMER_SIZE); // 0 = clean, 1 = ambiguous
    let ambigInWin  = 0;  // count of ambiguous chars in current window

    for (let i = 0; i < len; i++) {
      const ch = seq[i];

      // ── Update ambiguity window ─────────────────────────────────────────
      const slot    = i % KMER_SIZE;
      const evicted = ambigRing[slot];
      const isAmbig = !(ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T') ? 1 : 0;

      ambigInWin   -= evicted;
      ambigInWin   += isAmbig;
      ambigRing[slot] = isAmbig as 0 | 1;

      // ── AMBIGUITY_OVERFLOW check ────────────────────────────────────────
      // Only evaluate when we have a full window AND it contains non-ACGT chars.
      // O(KMER_SIZE) computation — skipped for clean ACGT input entirely.
      if (i >= KMER_SIZE - 1 && ambigInWin > 0) {
        const winStart = i - KMER_SIZE + 1;
        if (expansionCount(seq, winStart) > MAX_EXPANSION_SIZE) {
          const kmer    = seq.slice(winStart, winStart + KMER_SIZE);
          const dk      = `${globalStart + winStart}|AMBIGUITY_OVERFLOW|AO`;
          if (!seen.has(dk)) {
            seen.add(dk);
            result.push({
              position  : globalStart + winStart,
              pathogen  : 'AMBIGUITY_OVERFLOW',
              sequence  : kmer,
              matchType : 'AMBIGUITY_OVERFLOW',
              // TASK 4: no throw — scan continues unaffected.
            });
          }
        }
      }

      // ── NFA transition ──────────────────────────────────────────────────
      // Resolve which base indices this character can represent.
      const bases = IUPAC_BASES[ch] ?? (IUPAC_BASES['N'] as readonly Base[]);
      const next  = new Set<ACNode>();

      for (const s of active) {
        for (const b of bases) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const ns = s.g[b]!;
          next.add(ns);

          // ── Collect pattern matches ─────────────────────────────────
          if (ns.out.length > 0) {
            const matchStart = i - KMER_SIZE + 1;
            if (matchStart >= 0) {
              const rawKmer = seq.slice(matchStart, matchStart + KMER_SIZE);

              for (const out of ns.out) {
                // Determine matchType based on window ambiguity:
                //   Clean window → use the trie-stored EXACT / REVERSE_COMPLEMENT.
                //   Ambiguous window → POTENTIAL_MATCH (manual review required).
                const mt: ThreatMatch['matchType'] =
                  (ambigInWin === 0) ? out.mt : 'POTENTIAL_MATCH';

                const dk = `${globalStart + matchStart}|${out.pathogen}|${mt}`;
                if (!seen.has(dk)) {
                  seen.add(dk);
                  const m: ThreatMatch = {
                    position  : globalStart + matchStart,
                    pathogen  : out.pathogen,
                    sequence  : rawKmer,
                    matchType : mt,
                  };
                  if (mt === 'POTENTIAL_MATCH') {
                    // Record the specific ACGT expansion that triggered the hit.
                    m.matchedExpansion = out.kmer;
                  }
                  result.push(m);
                }
              }
            }
          }
        }
      }

      // Advance active set; reset to {root} if all states drained.
      active = next.size > 0 ? next : new Set<ACNode>([root]);
    }

    result.sort((a, b) => a.position - b.position);
    return result;
  }

  // ── Public scan wrapper (unchanged public API) ────────────────────────────

  /**
   * Scan a bounded sub-region of a DNA string for threat signatures.
   *
   * @param sequence    Input DNA (uppercase; may contain IUPAC/N).
   * @param start       Local start offset within `sequence` (default 0).
   * @param end         Local end offset within `sequence` (default: full).
   * @param globalStart Absolute genome offset of sequence[0] (default 0).
   * @returns           Sorted ThreatMatch array.
   */
  scan(
    sequence    : string,
    start       = 0,
    end?        : number,
    globalStart = 0,
  ): ThreatMatch[] {
    if (!this.isLoaded()) {
      throw new CriticalSecurityError('ScreeningEngine: no signature library loaded');
    }

    const sub = sequence.slice(start, end).toUpperCase();
    if (sub.length < KMER_SIZE) return [];

    return this.search(sub, globalStart + start);
  }

  // ── High-level slab-aware entry point ────────────────────────────────────

  /**
   * Scan a genome slab with an inter-slab overlap prefix (SEC-04).
   *
   * The caller MUST pass the last MAX_OVERLAP_BUFFER (48) bytes of the
   * previous slab as `overlappingPrefix` to prevent signatures from hiding
   * at 1MB slab boundaries.
   *
   * SEC-04 HARDENING (Sprint 2):
   *   Overlap increased from KMER_SIZE-1 = 23 to MAX_OVERLAP_BUFFER = 48.
   *   ArkheEngine.worker.ts must import MAX_OVERLAP_BUFFER and use it when
   *   extracting the prefix for each slab boundary stitch.
   *
   * @param sequence          Slab contents (uppercase ACGT/IUPAC).
   * @param globalStart       Absolute genome offset of sequence[0].
   * @param overlappingPrefix Last MAX_OVERLAP_BUFFER bytes of previous slab.
   */
  screenThreats(
    sequence          : string,
    globalStart       = 0,
    overlappingPrefix = '',
  ): ThreatMatch[] {
    if (!this.isLoaded()) {
      throw new CriticalSecurityError('ScreeningEngine: no signature library loaded');
    }

    // Take only the last MAX_OVERLAP_BUFFER bytes of the prefix (callers
    // may pass a longer tail; we clamp to the required buffer size).
    const prefix       = overlappingPrefix.slice(-MAX_OVERLAP_BUFFER);
    const effectiveSeq = (prefix + sequence).toUpperCase();
    const adjustedGS   = globalStart - prefix.length;

    return this.search(effectiveSeq, adjustedGS);
  }

  // ── Backwards-compat helpers ──────────────────────────────────────────────

  /**
   * Returns the reverse complement of a DNA string.
   * Public for unit testing; internally the scan path uses the module-level rcSeq().
   */
  reverseComplement(seq: string): string { return rcSeq(seq); }

  /**
   * Enumerate all ACGT realisations of an IUPAC-ambiguous k-mer.
   *
   * Retained for callers that invoke this method directly (e.g. offline
   * pre-validation scripts).  The AC scan path does NOT call expandIUPAC()
   * — ambiguity is handled natively by the NFA simulator.
   *
   * Returns null if expansion count exceeds MAX_EXPANSION_SIZE.
   */
  expandIUPAC(kmer: string): string[] | null {
    let results: string[] = [''];

    for (const ch of kmer.toUpperCase()) {
      const opts = IUPAC_BASES[ch];
      if (!opts) return null;
      const next: string[] = [];
      for (const prefix of results) {
        for (const b of opts) {
          next.push(prefix + BASE_CHARS[b]);
        }
      }
      if (next.length > MAX_EXPANSION_SIZE) return null;
      results = next;
    }
    return results;
  }

  /** @deprecated  Use isAmbiguous() from module scope if needed externally. */
  private isAmbiguous(kmer: string): boolean {
    for (let i = 0; i < kmer.length; i++) {
      const c = kmer[i];
      if (c !== 'A' && c !== 'C' && c !== 'G' && c !== 'T') return true;
    }
    return false;
  }
}