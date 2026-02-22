/**
 * src/lib/DiffEngine.ts
 * ============================================================================
 * ARKHÉ BIO‑DIFF – Myers diff algorithm optimized for DNA
 * ============================================================================
 *
 * Compares two strings (DNA sequences) and produces a list of delta operations.
 */

export interface Delta {
  position: number;        // 0‑based index in the original sequence
  type: 'mutation' | 'insertion' | 'deletion';
  value: string;           // the changed base(s) or inserted/deleted string
}

/**
 * Myers diff algorithm (O(ND) time, O(N) space) returning edit script.
 * Adapted from https://github.com/cubicdaiya/dtl (MIT)
 */
export class DiffEngine {
  /**
   * Compute the shortest edit script (SES) between two strings.
   * Returns an array of Delta objects.
   */
  diff(a: string, b: string): Delta[] {
    const n = a.length;
    const m = b.length;

    if (n === 0) {
      // All of b is insertion
      return [{ position: 0, type: 'insertion', value: b }];
    }
    if (m === 0) {
      // All of a is deletion
      return [{ position: 0, type: 'deletion', value: a }];
    }

    const max = n + m;
    const v = new Array(2 * max + 1);
    const vsnap: Array<{ x: number; y: number; op: 'copy' | 'ins' | 'del' }[]> = [];
    v[1] = 0;

    for (let d = 0; d <= max; d++) {
      for (let k = -d; k <= d; k += 2) {
        const index = k + max;
        let x: number;
        let op: 'copy' | 'ins' | 'del';

        if (k === -d || (k !== d && v[index - 1] < v[index + 1])) {
          x = v[index + 1];
          op = 'ins';
        } else {
          x = v[index - 1] + 1;
          op = 'del';
        }

        let y = x - k;

        // Follow diagonals
        while (x < n && y < m && a[x] === b[y]) {
          vsnap.push([{ x, y, op: 'copy' }]);
          x++;
          y++;
        }

        v[index] = x;

        if (x >= n && y >= m) {
          // Reached end – reconstruct path
          return this.reconstruct(vsnap, a, b, d);
        }

        vsnap.push([{ x, y, op }]);
      }
    }

    throw new Error('Diff failed – should never happen');
  }

  private reconstruct(
    vsnap: Array<{ x: number; y: number; op: 'copy' | 'ins' | 'del' }[]>,
    a: string,
    b: string,
    d: number
  ): Delta[] {
    const path: { x: number; y: number; op: 'copy' | 'ins' | 'del' }[] = [];
    let x = a.length;
    let y = b.length;

    // Walk backwards
    for (let i = vsnap.length - 1; i >= 0; i--) {
      const snap = vsnap[i];
      const last = snap[snap.length - 1];
      if (last.x === x && last.y === y) {
        path.push(last);
        x -= last.op === 'copy' ? 1 : 0;
        y -= last.op === 'copy' ? 1 : 0;
      } else {
        // follow the diagonal snap
        for (let j = snap.length - 1; j >= 0; j--) {
          const step = snap[j];
          if (step.op === 'copy') {
            x--;
            y--;
          }
          path.push(step);
          if (step.x === x && step.y === y) break;
        }
      }
    }

    // Reverse path and convert to Deltas
    path.reverse();
    const deltas: Delta[] = [];
    let pos = 0; // position in original a

    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      if (step.op === 'copy') {
        pos++;
        continue;
      }
      if (step.op === 'del') {
        // deletion at current pos
        deltas.push({
          position: pos,
          type: 'deletion',
          value: a[step.x],
        });
        pos++; // original index advances
      } else if (step.op === 'ins') {
        // insertion at current pos
        deltas.push({
          position: pos,
          type: 'insertion',
          value: b[step.y],
        });
        // pos does not advance
      }
    }

    return deltas;
  }

  /**
   * Compare a slab region with original sequence (if available)
   * Returns an array of Delta objects for the specified region.
   */
  diffSlabRegion(slabIndex: number, startOffset: number, endOffset: number): Delta[] {
    // For now, return empty diff - this would need access to original sequence
    // This is a placeholder implementation
    return [];
  }
}