// src/lib/StreamParser.ts
import { BASE, type BaseCode } from './bases';

export class StreamParser {
  private buffer = '';
  private inHeader = false; // persistent across chunks

  feedChunk(chunk: string, onBase: (baseCode: BaseCode) => void): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Detect FASTA header start
      if (trimmed.startsWith('>') || trimmed.startsWith('LOCUS')) {
        this.inHeader = true;
        continue;
      }

      // End of header on newline is already handled by line splitting,
      // but we must also consider ORIGIN and // markers
      if (trimmed.startsWith('ORIGIN')) {
        this.inHeader = false;
        continue;
      }
      if (trimmed === '//') {
        this.inHeader = false;
        continue;
      }

      // If we are not in a header, process sequence data
      if (!this.inHeader) {
        const seqLine = trimmed.replace(/\s+/g, '').toUpperCase();
        for (const ch of seqLine) {
          const code = BASE[ch];
          if (code !== undefined) {
            onBase(code);
          } else if (ch >= '0' && ch <= '9') {
            // ignore numbers (common in GenBank)
            continue;
          } else {
            onBase(4); // N for unknown
          }
        }
      }
    }
  }

  flush(onBase: (baseCode: BaseCode) => void): void {
    const seq = this.buffer.replace(/\s+/g, '').toUpperCase();
    for (const ch of seq) {
      const code = BASE[ch];
      onBase(code ?? 4);
    }
    this.buffer = '';
  }

  reset(): void {
    this.buffer = '';
    this.inHeader = false;
  }
}