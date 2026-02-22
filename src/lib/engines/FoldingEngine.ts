/**
 * src/lib/engines/FoldingEngine.ts
 * ============================================================================
 * ARKHÉ PROTEIN FOLDING ENGINE – with ESM Atlas fallback
 * ============================================================================
 *
 * Primary: fetch from ESM Metagenomic Atlas API (free).
 * Fallback: Chou‑Fasman heuristic for secondary structure.
 */

import type { ProteinFold } from '@/types/arkhe';

// ----------------------------------------------------------------------------
// Chou‑Fasman parameters (simplified)
// ----------------------------------------------------------------------------
const HELIX_PROB: Record<string, number> = {
  'A': 1.45, 'R': 0.98, 'N': 0.67, 'D': 0.67, 'C': 0.70,
  'Q': 1.11, 'E': 1.51, 'G': 0.57, 'H': 1.00, 'I': 1.08,
  'L': 1.21, 'K': 1.16, 'M': 1.45, 'F': 1.13, 'P': 0.57,
  'S': 0.77, 'T': 0.83, 'W': 1.08, 'Y': 0.69, 'V': 1.06,
  '*': 0.0, 'X': 0.5,
};
const SHEET_PROB: Record<string, number> = {
  'A': 0.97, 'R': 0.93, 'N': 0.89, 'D': 0.89, 'C': 1.19,
  'Q': 1.10, 'E': 0.37, 'G': 0.75, 'H': 0.87, 'I': 1.60,
  'L': 1.30, 'K': 0.74, 'M': 1.05, 'F': 1.38, 'P': 0.55,
  'S': 0.75, 'T': 1.19, 'W': 1.37, 'Y': 1.47, 'V': 1.70,
  '*': 0.0, 'X': 0.5,
};

/**
 * Simple 3D backbone generator (helix/sheet/coil) – used as fallback.
 */
function chouFasmanFold(aminoAcids: string): ProteinFold {
  const length = aminoAcids.length;
  const secondaryStructure: Array<'alpha' | 'beta' | 'coil'> = [];
  const confidence: number[] = [];

  for (let i = 0; i < length; i++) {
    const aa = aminoAcids[i];
    const h = HELIX_PROB[aa] ?? 0.5;
    const s = SHEET_PROB[aa] ?? 0.5;
    const total = h + s + 0.1;
    const pHelix = h / total;
    const pSheet = s / total;
    if (pHelix > 0.55) {
      secondaryStructure.push('alpha');
      confidence.push(pHelix);
    } else if (pSheet > 0.55) {
      secondaryStructure.push('beta');
      confidence.push(pSheet);
    } else {
      secondaryStructure.push('coil');
      confidence.push(0.5);
    }
  }

  // Generate a simple parametric backbone
  const coordinates: Array<{ x: number; y: number; z: number }> = [];
  let angle = 0;
  let z = 0;
  const basePitch = 1.5;

  for (let i = 0; i < length; i++) {
    let radius = 3.0;
    let pitch = basePitch;
    if (secondaryStructure[i] === 'alpha') {
      radius = 2.3;
      pitch = 1.5;
      angle += 0.5;
    } else if (secondaryStructure[i] === 'beta') {
      radius = 3.5;
      pitch = 3.5;
      angle += 0.3;
    } else {
      radius = 3.0;
      pitch = 2.0;
      angle += 0.4;
    }

    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    z += pitch;
    coordinates.push({ x, y, z });
  }

  return {
    aminoAcids,
    coordinates,
    secondaryStructure,
    confidence: confidence.map(c => Math.min(c, 0.6)), // Cap at 60% for heuristic
    atoms: [], // TODO: Implement atom calculation
    energy: 0, // TODO: Implement energy calculation
    rmsd: 0, // TODO: Implement RMSD calculation
    method: 'CHOU_FASMAN_HEURISTIC',
    warning: 'Heuristic prediction: Not for clinical use.',
  };
}

/**
 * Try to fetch from ESM Metagenomic Atlas.
 * Returns null on failure.
 */
async function fetchESMFold(sequence: string): Promise<ProteinFold | null> {
  try {
    // ESM Atlas API endpoint (example – adjust as needed)
    const response = await fetch('https://api.esmatlas.com/foldSequence/v1/pdb/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `sequence=${encodeURIComponent(sequence)}`,
    });

    if (!response.ok) return null;

    const pdbText = await response.text();

    // Very crude PDB parser – extract coordinates for CA atoms
    const lines = pdbText.split('\n');
    const coordinates: Array<{ x: number; y: number; z: number }> = [];
    const aminoAcids: string[] = [];
    const secondaryStructure: Array<'alpha' | 'beta' | 'coil'> = [];
    const confidence: number[] = [];
    const atomData: Array<{x: number, y: number, z: number, element: string, type: 'alpha'|'beta'|'coil'}> = [];

    for (const line of lines) {
      if (line.startsWith('ATOM') && line.substring(13, 15).trim() === 'CA') {
        // Atom serial  13-21? We'll just parse.
        try {
          const x = parseFloat(line.substring(30, 38));
          const y = parseFloat(line.substring(38, 46));
          const z = parseFloat(line.substring(46, 54));
          coordinates.push({ x, y, z });
          const aa = line.substring(17, 20).trim();
          aminoAcids.push(aa);
          // We don't have secondary structure from PDB, so we'll guess
          secondaryStructure.push('coil');
          confidence.push(0.8);
          atomData.push({x, y, z, element: 'C', type: 'alpha'});
        } catch {
          // skip malformed line
        }
      }
    }

    if (coordinates.length === 0) return null;

    return {
      aminoAcids: aminoAcids.join(''),
      coordinates,
      secondaryStructure,
      confidence,
      atoms: atomData,
      energy: 0, // TODO: Implement energy calculation
      rmsd: 0, // TODO: Implement RMSD calculation
      method: 'ESM_ATLAS',
    };
  } catch {
    return null;
  }
}

/**
 * Main folding function – tries ESM first, falls back to Chou‑Fasman.
 */
export async function computeProteinFold(dna: string): Promise<ProteinFold> {
  // Translate DNA to amino acids (using existing BioLogic)
  const { translateFrame } = await import('@/lib/BioLogic');
  const encoder = new TextEncoder();
  const buffer = encoder.encode(dna);
  const aminoAcids = translateFrame(buffer, 0); // assume frame 0

  if (aminoAcids.length === 0) {
    return {
      aminoAcids: '',
      coordinates: [],
      secondaryStructure: [],
      confidence: [],
      atoms: [],
      energy: 0,
      rmsd: 0,
      method: 'EMPTY_SEQUENCE',
    };
  }

  // Try ESM
  const esmFold = await fetchESMFold(aminoAcids);
  if (esmFold) {
    return esmFold;
  }

  // Fallback to Chou‑Fasman
  return chouFasmanFold(aminoAcids);
}