/**
 * sentinelAudit.ts
 * Production-grade sentinel scan for biohazards (GC content, redline patterns, repeats).
 */

export interface BioHazard {
  type: 'gc-content' | 'redline' | 'repeat' | 'hairpin';
  position: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

// Redline patterns – sequences associated with pathogenic or problematic regions
const REDLINE_PATTERNS: Array<{ pattern: string; name: string; severity: 'low' | 'medium' | 'high' | 'critical' }> = [
  { pattern: 'CCGGCC', name: 'GC-Rich Region', severity: 'medium' },
  { pattern: 'ATATATAT', name: 'AT Repeat', severity: 'low' },
  { pattern: 'GGGGG', name: 'G-Quadruplex', severity: 'high' },
  { pattern: 'CTCCAG', name: 'Pathogenic Motif', severity: 'critical' },
  { pattern: 'CCTG', name: 'Myotonic Dystrophy Repeat', severity: 'high' },
  { pattern: 'GGGGCC', name: 'ALS/FTD Repeat', severity: 'critical' },
];

// Simple repeats (homopolymers)
const HOMOPOLYMERS = ['AAAAA', 'CCCCC', 'GGGGG', 'TTTTT'];

export async function performSentinelAudit(
  sequence: string,
  start = 0,
  end?: number
): Promise<BioHazard[]> {
  const seq = sequence.slice(start, end).toUpperCase();
  const hazards: BioHazard[] = [];

  // 1. GC-content violation
  const gcCount = (seq.match(/[GC]/g) || []).length;
  const gcPercent = (gcCount / seq.length) * 100;
  if (gcPercent < 30) {
    hazards.push({
      type: 'gc-content',
      position: start + Math.floor(seq.length / 2),
      severity: 'medium',
      description: `GC content too low: ${gcPercent.toFixed(1)}% (<30%)`,
    });
  } else if (gcPercent > 70) {
    hazards.push({
      type: 'gc-content',
      position: start + Math.floor(seq.length / 2),
      severity: 'high',
      description: `GC content too high: ${gcPercent.toFixed(1)}% (>70%)`,
    });
  }

  // 2. Redline pattern search
  for (const { pattern, name, severity } of REDLINE_PATTERNS) {
    let pos = seq.indexOf(pattern);
    while (pos !== -1) {
      hazards.push({
        type: 'redline',
        position: start + pos,
        severity,
        description: `Redline pattern "${name}" found`,
      });
      pos = seq.indexOf(pattern, pos + 1);
    }
  }

  // 3. Homopolymer detection (≥5 identical bases)
  for (const poly of HOMOPOLYMERS) {
    let pos = seq.indexOf(poly);
    while (pos !== -1) {
      hazards.push({
        type: 'repeat',
        position: start + pos,
        severity: 'medium',
        description: `Homopolymer ${poly[0]} repeat`,
      });
      pos = seq.indexOf(poly, pos + 1);
    }
  }

  return hazards;
}