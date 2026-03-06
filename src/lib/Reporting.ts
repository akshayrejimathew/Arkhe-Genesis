/**
 * src/lib/Reporting.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SPRINT C — Sovereign Audit / Clinical Validation Report
 *
 * Compiles a point-in-time snapshot of the loaded genome into a clean,
 * printable HTML document that can be saved as PDF via the browser print
 * dialogue (Ctrl/Cmd+P → Save as PDF).
 *
 * Sections:
 *   1. Report header  — Lab name, report ID, generation timestamp, analyst
 *   2. Sequence Info  — Active genome ID, length, GC%, viewport window
 *   3. Source Badge   — NCBI Verified / UniProt / Unvalidated Draft / Mutated
 *   4. Molecular Weight — Computed from observed nucleotide composition
 *   5. Sentinel Status  — Security-clearance summary (from sentinel scan)
 *   6. Secondary Structure — GOR IV propensity table for visible ORF0
 *   7. Chronos Head     — Current commit SHA + message (audit trail)
 *   8. Compliance footer — Research / Clinical watermark + disclaimer
 *
 * The function opens the report in a new browser tab ready to print.
 * No server round-trip is required — all data comes from the Zustand store
 * and the SourceTracker singleton.
 */

import { useArkheStore } from '@/store';
import { SourceTracker } from '@/lib/ExternalData';

// ─────────────────────────────────────────────────────────────────────────────
// § Molecular weight
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Average monoisotopic residue masses for deoxyribonucleotides (Da).
 * Source: Sigma-Aldrich / NEB oligonucleotide calculator conventions.
 */
const NUC_MW: Record<string, number> = {
  A: 313.21, T: 304.19, G: 329.21, C: 289.18,
  // IUPAC ambiguity codes — use average of possible bases
  R: 321.21, Y: 296.69, S: 309.20, W: 308.70,
  K: 316.70, M: 301.20, B: 307.53, D: 315.54,
  H: 302.19, V: 310.53, N: 308.95, U: 305.18,
};

/** Average phosphate backbone mass subtracted per inter-residue linkage (Da). */
const PHOSPHATE_LOSS = 61.96;

/**
 * Computes approximate single-stranded molecular weight for a DNA sequence.
 * Formula: sum of residue masses − (n−1) × water loss per phosphodiester bond.
 * Returns mass in kDa, rounded to 2 decimal places.
 */
export function computeMolecularWeight(sequence: string): number {
  if (!sequence.length) return 0;
  const seq = sequence.toUpperCase();
  let mass = 0;
  for (const base of seq) {
    mass += NUC_MW[base] ?? NUC_MW['N'];
  }
  // Subtract water for each phosphodiester bond (n−1 bonds for n residues)
  // and add one water for the free 5′-OH terminus.
  mass -= (seq.length - 1) * PHOSPHATE_LOSS;
  mass += 18.02; // terminal water
  return Math.round((mass / 1000) * 100) / 100; // kDa
}

// ─────────────────────────────────────────────────────────────────────────────
// § GOR IV secondary structure (propensity heuristic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simplified GOR IV propensity tables for the 20 standard amino acids.
 * Values represent the log-odds propensity for each of the three states:
 *   H = α-helix, E = β-strand, C = random coil
 *
 * These are derived from the original Garnier, Osguthorpe & Robson (1978)
 * tables and are suitable for display in a research/clinical audit context.
 * They are NOT intended as a substitute for a validated folding prediction.
 */
const GOR_PROPENSITY: Record<string, { H: number; E: number; C: number }> = {
  A: { H:  1.45, E: -0.42, C: -1.03 },
  R: { H:  0.79, E: -1.60, C:  0.81 },
  N: { H: -1.17, E: -2.04, C:  3.21 },
  D: { H: -0.92, E: -2.56, C:  3.48 },
  C: { H: -0.64, E:  1.11, C: -0.47 },
  Q: { H:  0.96, E: -1.30, C:  0.34 },
  E: { H:  1.53, E: -1.71, C:  0.19 },
  G: { H: -2.06, E: -1.31, C:  4.37 },
  H: { H:  0.67, E: -1.12, C:  0.45 },
  I: { H:  1.00, E:  1.97, C: -2.97 },
  L: { H:  1.34, E:  0.31, C: -1.65 },
  K: { H:  0.84, E: -1.54, C:  0.70 },
  M: { H:  1.37, E:  0.42, C: -1.79 },
  F: { H:  1.12, E:  1.63, C: -2.75 },
  P: { H: -2.19, E: -2.38, C:  4.57 },
  S: { H: -0.80, E: -0.25, C:  1.05 },
  T: { H: -0.74, E:  0.97, C: -0.23 },
  W: { H:  0.81, E:  1.44, C: -2.25 },
  Y: { H:  0.27, E:  2.20, C: -2.47 },
  V: { H:  0.91, E:  2.22, C: -3.13 },
  X: { H:  0.00, E:  0.00, C:  0.00 }, // unknown
};

const CODON_TABLE: Record<string, string> = {
  TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',
  ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',
  TCT:'S',TCC:'S',TCA:'S',TCG:'S',CCT:'P',CCC:'P',CCA:'P',CCG:'P',
  ACT:'T',ACC:'T',ACA:'T',ACG:'T',GCT:'A',GCC:'A',GCA:'A',GCG:'A',
  TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',
  AAT:'N',AAC:'N',AAA:'K',AAG:'K',GAT:'D',GAC:'D',GAA:'E',GAG:'E',
  TGT:'C',TGC:'C',TGA:'*',TGG:'W',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
  AGT:'S',AGC:'S',AGA:'R',AGG:'R',GGT:'G',GGC:'G',GGA:'G',GGG:'G',
};

function translateFrame0(dna: string): string {
  const seq = dna.toUpperCase();
  let aa = '';
  for (let i = 0; i + 2 < seq.length; i += 3) {
    const codon = seq.slice(i, i + 3);
    const residue = CODON_TABLE[codon] ?? 'X';
    if (residue === '*') break;
    aa += residue;
  }
  return aa;
}

interface GORResult {
  aaSequence:  string;
  helixPct:    number;
  strandPct:   number;
  coilPct:     number;
  perResidue:  Array<{ aa: string; state: 'H' | 'E' | 'C'; H: number; E: number; C: number }>;
}

export function runGORIV(dna: string): GORResult {
  const aa = translateFrame0(dna);
  if (!aa.length) {
    return { aaSequence: '', helixPct: 0, strandPct: 0, coilPct: 0, perResidue: [] };
  }

  const perResidue = aa.split('').map(residue => {
    const p  = GOR_PROPENSITY[residue] ?? GOR_PROPENSITY['X'];
    const maxKey = (Object.keys(p) as Array<'H'|'E'|'C'>).reduce(
      (best, k) => p[k] > p[best] ? k : best, 'C' as 'H'|'E'|'C'
    );
    return { aa: residue, state: maxKey, ...p };
  });

  const h = perResidue.filter(r => r.state === 'H').length;
  const e = perResidue.filter(r => r.state === 'E').length;
  const c = perResidue.filter(r => r.state === 'C').length;
  const n = perResidue.length;

  return {
    aaSequence:  aa,
    helixPct:    Math.round((h / n) * 1000) / 10,
    strandPct:   Math.round((e / n) * 1000) / 10,
    coilPct:     Math.round((c / n) * 1000) / 10,
    perResidue,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § Source badge helpers (mirrors Workbench SourceBadge logic)
// ─────────────────────────────────────────────────────────────────────────────

function sourceLabel(source: ReturnType<typeof SourceTracker.get>): string {
  if (!source || source.type === 'file') return 'UNVALIDATED DRAFT';
  if (source.type === 'manual')          return source.label ?? 'MUTATED';
  if (source.type === 'ncbi')            return `NCBI VERIFIED: ${source.id}`;
  if (source.type === 'uniprot')         return `UNIPROT: ${source.id}`;
  return 'UNVALIDATED DRAFT';
}

function sourceBadgeHtml(source: ReturnType<typeof SourceTracker.get>): string {
  if (!source || source.type === 'file') {
    return `<span class="badge badge-yellow">⚠ UNVALIDATED DRAFT</span>`;
  }
  if (source.type === 'manual') {
    return `<span class="badge badge-orange">⚠ ${source.label ?? 'MUTATED'}</span>`;
  }
  if (source.type === 'ncbi') {
    return `<span class="badge badge-green">✓ NCBI VERIFIED: ${source.id}</span>`;
  }
  if (source.type === 'uniprot') {
    return `<span class="badge badge-blue">✓ UNIPROT: ${source.id}</span>`;
  }
  return `<span class="badge badge-yellow">⚠ UNVALIDATED DRAFT</span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Sentinel status helper
// ─────────────────────────────────────────────────────────────────────────────

function sentinelSummaryHtml(sentinelResults: unknown[]): string {
  if (!sentinelResults.length) {
    return `<p class="dim">No Sentinel scan has been run for this session.</p>`;
  }
  const totalBins = sentinelResults.length;
  const flagged   = sentinelResults.filter((r: any) =>
    r.gcPercent < 30 || r.gcPercent > 70 || Object.values(r.motifCounts ?? {}).some((v: any) => v > 10)
  ).length;
  const pct = Math.round((flagged / totalBins) * 100);

  if (flagged === 0) {
    return `<p class="pass">✓ CLEARED — All ${totalBins} bins within normal parameters. No anomalous motifs detected.</p>`;
  }
  return `<p class="warn">⚠ ${flagged}/${totalBins} bins flagged (${pct}%). Review Sentinel heatmap before clinical use.</p>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// § GOR IV table fragment
// ─────────────────────────────────────────────────────────────────────────────

function gorTableHtml(gor: GORResult): string {
  if (!gor.aaSequence.length) {
    return `<p class="dim">No open reading frame found in the current viewport window.</p>`;
  }

  // Show first 80 residues in the per-residue table; truncate with a note.
  const DISPLAY_LIMIT = 80;
  const slice = gor.perResidue.slice(0, DISPLAY_LIMIT);
  const truncated = gor.perResidue.length > DISPLAY_LIMIT;

  const rows = slice
    .map((r, i) => {
      const stateColor = r.state === 'H' ? '#A78BFA' : r.state === 'E' ? '#34D399' : '#94A3B8';
      return `<tr>
        <td class="mono">${i + 1}</td>
        <td class="mono"><b>${r.aa}</b></td>
        <td style="color:${stateColor};font-weight:700">${r.state === 'H' ? 'α-Helix' : r.state === 'E' ? 'β-Strand' : 'Coil'}</td>
        <td class="num">${r.H.toFixed(2)}</td>
        <td class="num">${r.E.toFixed(2)}</td>
        <td class="num">${r.C.toFixed(2)}</td>
      </tr>`;
    })
    .join('\n');

  return `
    <div class="gor-summary">
      <span class="pill pill-purple">α-Helix: ${gor.helixPct}%</span>
      <span class="pill pill-green">β-Strand: ${gor.strandPct}%</span>
      <span class="pill pill-gray">Coil: ${gor.coilPct}%</span>
    </div>
    <p class="aa-seq mono">${gor.aaSequence.slice(0, 100)}${gor.aaSequence.length > 100 ? '…' : ''}</p>
    <table class="gor-table">
      <thead>
        <tr>
          <th>#</th><th>AA</th><th>State</th>
          <th>P(H)</th><th>P(E)</th><th>P(C)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${truncated ? `<p class="dim">Showing first ${DISPLAY_LIMIT} of ${gor.perResidue.length} residues.</p>` : ''}
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Main report builder
// ─────────────────────────────────────────────────────────────────────────────

export interface ClinicalReportOptions {
  /** Lab or institution name shown in the report header. */
  labName?:     string;
  /** Analyst name shown in the report header. */
  analystName?: string;
  /** Whether to include the GOR IV section (can be slow for very long ORFs). */
  includeGOR?: boolean;
}

/**
 * Compiles all available genomic metadata from the current store state into a
 * printable HTML document and opens it in a new browser tab.
 *
 * The user can then use Ctrl/Cmd+P → "Save as PDF" to produce a sovereign
 * audit-grade PDF without any server dependency.
 */
export function generateClinicalReport(options: ClinicalReportOptions = {}): void {
  const {
    labName     = 'Arkhé Genesis Laboratory',
    analystName = 'Unspecified Analyst',
    includeGOR  = true,
  } = options;

  const state = useArkheStore.getState();
  const source = SourceTracker.get();

  const genomeLength   = state.genomeLength;
  const activeId       = state.activeGenomeId     ?? '—';
  const chronosHead    = state.chronosHead        ?? null;
  const observedSeq    = state.viewport?.sequence ?? '';
  const viewStart      = state.viewport?.start    ?? 0;
  const viewEnd        = state.viewport?.end      ?? genomeLength;
  const sentinelResults: unknown[] = (state as any).sentinelScanResults ?? [];

  const mwKda        = computeMolecularWeight(observedSeq);
  const gcPct        = observedSeq.length
    ? Math.round(((observedSeq.match(/[GCgc]/g) ?? []).length / observedSeq.length) * 10_000) / 100
    : 0;

  const gor = (includeGOR && observedSeq.length > 0)
    ? runGORIV(observedSeq)
    : null;

  const isClinicalReady = source?.type === 'ncbi' || source?.type === 'uniprot';
  const watermarkLabel  = isClinicalReady ? 'CLINICAL READY' : 'FOR RESEARCH USE ONLY';
  const watermarkColor  = isClinicalReady ? 'rgba(16,185,129,0.07)' : 'rgba(234,179,8,0.07)';

  const reportId  = Math.random().toString(36).slice(2, 10).toUpperCase();
  const now       = new Date();
  const timestamp = now.toUTCString();

  // ── HTML document ──────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Arkhé Genesis — Clinical Validation Report ${reportId}</title>
  <style>
    /* ── Reset & base ──────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 13px; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #0F172A;
      background: #FFFFFF;
      padding: 40px 48px;
      position: relative;
    }

    /* ── Watermark ──────────────────────────────────────────────────────── */
    body::before {
      content: '${watermarkLabel}';
      position: fixed;
      top: 50%;  left: 50%;
      transform: translate(-50%, -50%) rotate(-35deg);
      font-size: 72px;
      font-weight: 900;
      letter-spacing: -0.02em;
      color: ${watermarkColor};
      pointer-events: none;
      white-space: nowrap;
      z-index: 0;
    }

    /* ── Layout ─────────────────────────────────────────────────────────── */
    .content { position: relative; z-index: 1; max-width: 900px; margin: 0 auto; }

    /* ── Header ─────────────────────────────────────────────────────────── */
    .report-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding-bottom: 20px;
      border-bottom: 2px solid #0F172A;
      margin-bottom: 28px;
    }
    .report-header h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.03em; }
    .report-header h1 span { color: #0EA5E9; }
    .report-header .meta { font-size: 11px; color: #64748B; line-height: 1.8; text-align: right; }
    .report-id {
      font-family: 'Courier New', monospace;
      font-size: 11px; font-weight: 700;
      color: #0F172A;
      background: #F1F5F9;
      border: 1px solid #CBD5E1;
      padding: 2px 8px; border-radius: 3px;
    }

    /* ── Section structure ──────────────────────────────────────────────── */
    .section { margin-bottom: 28px; }
    .section-title {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: #64748B;
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 6px; margin-bottom: 14px;
    }

    /* ── Data grid ──────────────────────────────────────────────────────── */
    .data-grid {
      display: grid; grid-template-columns: 200px 1fr;
      gap: 8px 16px; align-items: start;
    }
    .data-label { font-size: 12px; color: #64748B; font-weight: 600; }
    .data-value { font-size: 12px; color: #0F172A; }

    /* ── Badges ─────────────────────────────────────────────────────────── */
    .badge {
      display: inline-block;
      font-family: 'Courier New', monospace;
      font-size: 11px; font-weight: 700;
      padding: 3px 10px; border-radius: 4px;
      letter-spacing: 0.04em;
    }
    .badge-green  { background: rgba(16,185,129,0.10); color: #059669; border: 1px solid rgba(16,185,129,0.30); }
    .badge-blue   { background: rgba(99,102,241,0.10); color: #4F46E5; border: 1px solid rgba(99,102,241,0.30); }
    .badge-yellow { background: rgba(234,179,8,0.10);  color: #92400E; border: 1px solid rgba(234,179,8,0.30); }
    .badge-orange { background: rgba(249,115,22,0.10); color: #C2410C; border: 1px solid rgba(249,115,22,0.30); }

    /* ── Clinical watermark pill ──────────────────────────────────────── */
    .clinical-pill {
      display: inline-block;
      font-size: 12px; font-weight: 800;
      padding: 5px 14px; border-radius: 5px;
      letter-spacing: 0.06em;
      ${isClinicalReady
        ? 'background: rgba(16,185,129,0.10); color: #059669; border: 1.5px solid rgba(16,185,129,0.35);'
        : 'background: rgba(234,179,8,0.10);  color: #92400E; border: 1.5px solid rgba(234,179,8,0.35);'}
    }

    /* ── GOR table ─────────────────────────────────────────────────────── */
    .gor-summary { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .pill {
      display: inline-block;
      font-size: 11px; font-weight: 700;
      padding: 3px 10px; border-radius: 12px;
    }
    .pill-purple { background: rgba(167,139,250,0.15); color: #7C3AED; }
    .pill-green  { background: rgba(52,211,153,0.15);  color: #059669; }
    .pill-gray   { background: rgba(148,163,184,0.15); color: #475569; }
    .gor-table {
      width: 100%; border-collapse: collapse;
      font-size: 11px; margin-top: 10px;
    }
    .gor-table th {
      background: #F8FAFC; padding: 6px 10px;
      text-align: left; border: 1px solid #E2E8F0;
      font-weight: 700; color: #475569;
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .gor-table td {
      padding: 5px 10px;
      border: 1px solid #F1F5F9;
      color: #334155;
    }
    .gor-table tr:nth-child(even) td { background: #F8FAFC; }
    .num  { text-align: right; font-family: 'Courier New', monospace; }
    .mono { font-family: 'Courier New', monospace; font-size: 11px; }
    .aa-seq {
      font-family: 'Courier New', monospace;
      font-size: 11px; color: #334155;
      background: #F8FAFC; border: 1px solid #E2E8F0;
      padding: 8px 12px; border-radius: 4px;
      word-break: break-all; line-height: 1.8;
      margin-bottom: 12px;
    }

    /* ── Status helpers ─────────────────────────────────────────────────── */
    .pass  { color: #059669; font-size: 12px; }
    .warn  { color: #92400E; font-size: 12px; }
    .dim   { color: #94A3B8; font-size: 12px; font-style: italic; }

    /* ── Footer ─────────────────────────────────────────────────────────── */
    .footer {
      margin-top: 36px; padding-top: 16px;
      border-top: 1px solid #E2E8F0;
      display: flex; justify-content: space-between; align-items: flex-end;
      font-size: 10px; color: #94A3B8;
    }
    .footer .disclaimer { max-width: 560px; line-height: 1.6; }

    /* ── Print ──────────────────────────────────────────────────────────── */
    @media print {
      body { padding: 20px 28px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
<div class="content">

  <!-- ── PRINT BUTTON (hidden on print) ───────────────────────────────── -->
  <div class="no-print" style="text-align:right;margin-bottom:18px;">
    <button onclick="window.print()"
      style="padding:8px 18px;background:#0EA5E9;color:#fff;border:none;border-radius:5px;
             font-size:13px;font-weight:700;cursor:pointer;letter-spacing:0.04em;">
      ⬇ Save as PDF
    </button>
  </div>

  <!-- ── HEADER ──────────────────────────────────────────────────────────── -->
  <header class="report-header">
    <div>
      <h1>Arkhé<span>Genesis</span> · Clinical Validation Report</h1>
      <div style="margin-top:8px;font-size:11px;color:#64748B;">
        ${labName} &nbsp;·&nbsp; ${analystName}
      </div>
    </div>
    <div class="meta">
      <div class="report-id">REPORT-${reportId}</div>
      <div style="margin-top:6px;">${timestamp}</div>
      <div style="margin-top:4px;">Arkhé Genesis v1.0-sprint-c</div>
    </div>
  </header>

  <!-- ── SECTION 1 — Sequence Information ─────────────────────────────────── -->
  <section class="section">
    <div class="section-title">1 · Sequence Information</div>
    <div class="data-grid">
      <div class="data-label">Genome ID</div>
      <div class="data-value mono">${activeId}</div>

      <div class="data-label">Total Length</div>
      <div class="data-value">${genomeLength.toLocaleString()} bp</div>

      <div class="data-label">Viewport Window</div>
      <div class="data-value mono">${viewStart.toLocaleString()} – ${viewEnd.toLocaleString()} bp</div>

      <div class="data-label">GC Content (viewport)</div>
      <div class="data-value">${gcPct}%</div>

      <div class="data-label">Observed Sequence</div>
      <div class="data-value aa-seq" style="margin:0;">${observedSeq.slice(0, 120)}${observedSeq.length > 120 ? `… (+${(observedSeq.length - 120).toLocaleString()} bp)` : ''}</div>
    </div>
  </section>

  <!-- ── SECTION 2 — Source Provenance ─────────────────────────────────────── -->
  <section class="section">
    <div class="section-title">2 · Source Provenance</div>
    <div class="data-grid">
      <div class="data-label">Source Badge</div>
      <div class="data-value">${sourceBadgeHtml(source)}</div>

      ${source?.type === 'ncbi' ? `
      <div class="data-label">NCBI Accession</div>
      <div class="data-value mono">${source.id}</div>` : ''}

      ${source?.type === 'uniprot' ? `
      <div class="data-label">UniProt ID</div>
      <div class="data-value mono">${source.id}</div>` : ''}

      <div class="data-label">Clinical Status</div>
      <div class="data-value"><span class="clinical-pill">${watermarkLabel}</span></div>
    </div>
  </section>

  <!-- ── SECTION 3 — Molecular Weight ──────────────────────────────────────── -->
  <section class="section">
    <div class="section-title">3 · Molecular Weight (Viewport Sequence)</div>
    <div class="data-grid">
      <div class="data-label">Method</div>
      <div class="data-value">Residue mass summation (single-stranded DNA, 5′-OH terminus)</div>

      <div class="data-label">Molecular Weight</div>
      <div class="data-value"><b>${mwKda.toLocaleString()} kDa</b></div>

      <div class="data-label">Residue Count</div>
      <div class="data-value">${observedSeq.length.toLocaleString()} nt</div>
    </div>
  </section>

  <!-- ── SECTION 4 — Sentinel Security Clearance ───────────────────────────── -->
  <section class="section">
    <div class="section-title">4 · Sentinel Security Clearance</div>
    ${sentinelSummaryHtml(sentinelResults)}
  </section>

  <!-- ── SECTION 5 — GOR IV Secondary Structure ───────────────────────────── -->
  <section class="section">
    <div class="section-title">5 · GOR IV Secondary Structure (Frame 0, Viewport)</div>
    ${gor ? gorTableHtml(gor) : '<p class="dim">GOR IV analysis not available for this viewport.</p>'}
    <p class="dim" style="margin-top:10px;">
      GOR IV is a heuristic propensity-table method (Garnier, Osguthorpe &amp; Robson 1978).
      Results are indicative only and must not be used for clinical decision-making without
      validation by a certified folding prediction service (e.g., ESM Atlas, AlphaFold).
    </p>
  </section>

  <!-- ── SECTION 6 — Chronos Audit Trail ──────────────────────────────────── -->
  <section class="section">
    <div class="section-title">6 · Chronos Audit Trail</div>
    <div class="data-grid">
      <div class="data-label">Current HEAD</div>
      <div class="data-value mono">${chronosHead ?? '(no commits in this session)'}</div>
    </div>
  </section>

  <!-- ── FOOTER ──────────────────────────────────────────────────────────── -->
  <footer class="footer">
    <p class="disclaimer">
      <b>DISCLAIMER:</b> This report is generated automatically by the Arkhé Genesis
      Genomic IDE and is intended for informational purposes only.
      ${isClinicalReady
        ? 'Sequence has been fetched from a verified external database. Confirm all findings with a certified clinical laboratory before diagnostic or therapeutic use.'
        : '<b>This sequence has not been validated against an external reference database. It must not be used for diagnostic, therapeutic, or clinical decision-making purposes.</b>'}
    </p>
    <p style="text-align:right;white-space:nowrap;margin-left:24px;">
      Report ID: REPORT-${reportId}<br/>
      Arkhé Genesis v1.0-sprint-c
    </p>
  </footer>

</div>
</body>
</html>`;

  // Open in a new tab and trigger print dialogue after the document loads.
  const win = window.open('', '_blank');
  if (!win) {
    console.error('[Reporting] window.open was blocked. Allow pop-ups for Arkhé Genesis.');
    return;
  }
  win.document.write(html);
  win.document.close();
}