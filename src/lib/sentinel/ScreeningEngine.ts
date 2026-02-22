/**
 * src/lib/sentinel/ScreeningEngine.ts
 * ============================================================================
 * ARKHÉ SENTINEL – K‑mer Threat Screening Engine
 * ============================================================================
 *
 * Scans a DNA sequence against a library of known pathogen signatures.
 * Uses 12‑base rolling hash for O(n) time.
 */

export interface ThreatMatch {
  position: number;        // 0‑based start coordinate
  pathogen: string;        // e.g., "SARS‑CoV‑2" or "Toxoplasma gondii"
  sequence: string;        // the matching 12‑mer
}

export interface SignatureLibrary {
  version: string;         // e.g., "1.2.4"
  signatures: Map<string, string>; // key: 12‑mer (string), value: pathogen name
}

const KMER_SIZE = 12;

/**
 * Rolling hash for fast substring search.
 * Uses a simple polynomial hash (base 4) to avoid collisions.
 */
export class RollingHash {
  private hash = 0;
  private base = 4;          // 4 possible bases (A,C,G,T)
  private mod = 2**31 - 1;   // large prime
  private basePow: number;

  constructor() {
    // pre‑compute base^(k-1) mod mod
    this.basePow = 1;
    for (let i = 0; i < KMER_SIZE - 1; i++) {
      this.basePow = (this.basePow * this.base) % this.mod;
    }
  }

  /** Convert a base character to a numeric value (0-3). 'N' becomes 0. */
  private charVal(ch: string): number {
    switch (ch.toUpperCase()) {
      case 'A': return 0;
      case 'C': return 1;
      case 'G': return 2;
      case 'T': return 3;
      default:  return 0; // N or unknown → treat as A (least harmful)
    }
  }

  /** Compute initial hash for the first k‑mer. */
  init(seq: string): number {
    this.hash = 0;
    for (let i = 0; i < KMER_SIZE && i < seq.length; i++) {
      this.hash = (this.hash * this.base + this.charVal(seq[i])) % this.mod;
    }
    return this.hash;
  }

  /** Update hash when sliding window one step. */
  update(prevChar: string, nextChar: string): number {
    const prevVal = this.charVal(prevChar);
    const nextVal = this.charVal(nextChar);
    // remove leftmost character
    this.hash = (this.hash - prevVal * this.basePow) % this.mod;
    if (this.hash < 0) this.hash += this.mod;
    // add new character
    this.hash = (this.hash * this.base + nextVal) % this.mod;
    return this.hash;
  }
}

export class ScreeningEngine {
  private library: SignatureLibrary | null = null;

  /** Load a signature library (from IndexedDB or network). */
  loadLibrary(lib: SignatureLibrary): void {
    this.library = lib;
  }

  /** Check if a library is loaded. */
  isLoaded(): boolean {
    return this.library !== null;
  }

  /** Get current library version. */
  getVersion(): string | null {
    return this.library?.version || null;
  }

  /**
   * Scan a DNA sequence (uppercase A,C,G,T,N) for threat signatures.
   * Returns an array of ThreatMatch objects sorted by position.
   */
  scan(sequence: string, start = 0, end?: number): ThreatMatch[] {
    if (!this.library) {
      throw new Error('ScreeningEngine: no signature library loaded');
    }

    const seq = sequence.slice(start, end).toUpperCase();
    const len = seq.length;
    if (len < KMER_SIZE) return [];

    const matches: ThreatMatch[] = [];
    const signatures = this.library.signatures;
    const hasher = new RollingHash();

    // First k‑mer
    let hash = hasher.init(seq);
    let kmer = seq.slice(0, KMER_SIZE);
    if (signatures.has(kmer)) {
      matches.push({
        position: start,
        pathogen: signatures.get(kmer)!,
        sequence: kmer,
      });
    }

    // Slide the window
    for (let i = 1; i <= len - KMER_SIZE; i++) {
      hash = hasher.update(seq[i - 1], seq[i + KMER_SIZE - 1]);
      // We need the actual string for the map, but hash alone is insufficient due to collisions.
      // So we fetch the k‑mer string and check the map.
      kmer = seq.slice(i, i + KMER_SIZE);
      if (signatures.has(kmer)) {
        matches.push({
          position: start + i,
          pathogen: signatures.get(kmer)!,
          sequence: kmer,
        });
      }
    }

    return matches;
  }
}