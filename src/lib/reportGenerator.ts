/**
 * src/lib/reportGenerator.ts
 * Genesis Audit Report Generator
 * Captures current session state and produces a signed Laboratory Certificate.
 */

import { useArkheStore } from '@/store';
import type { SystemLog } from '@/store/types';

export interface AuditReport {
  id: string;
  timestamp: number;
  genome: {
    id: string | null;
    length: number;
    name: string | null;
  };
  mutations: number;
  safetyScore: number;
  proteinDelta: number | null;
  signature: string; // mock SHA‑256 hash
  html: string;
}

/**
 * Generates a mock SHA‑256 hash of the report content.
 */
function generateSignature(content: string): string {
  // Simple djb2 hash (non‑cryptographic, for mock only)
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(64, '0').slice(0, 64);
}

/**
 * Creates an HTML Laboratory Certificate from the current store state.
 */
export async function generateAuditReport(): Promise<AuditReport> {
  const state = useArkheStore.getState();

  // Collect data
  const genomeId = state.activeGenomeId;
  const genomeLength = state.genomeLength;
  const genomeName = state.activeGenomeId; // could be improved

  const mutationCount = state.commits.reduce((acc, c) => acc + c.mutations.length, 0);
  const safetyScore = state.sentinelHazards.length > 0
    ? Math.max(0, 100 - state.sentinelHazards.length * 10)
    : 100;

  const proteinDelta = state.proteinFold?.confidence
    ? state.proteinFold.confidence.reduce((a, b) => a + b, 0) / state.proteinFold.confidence.length
    : null;

  const reportId = `GEN-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`.toUpperCase();

  // Build content for signature
  const content = [
    reportId,
    Date.now(),
    genomeId,
    genomeLength,
    mutationCount,
    safetyScore,
    proteinDelta,
  ].join('|');

  const signature = generateSignature(content);

  // HTML template
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Arkhé Genesis Audit Report</title>
  <style>
    body {
      background: #09090b;
      color: #fafafa;
      font-family: 'Inter', system-ui, sans-serif;
      line-height: 1.5;
      padding: 2rem;
    }
    .certificate {
      max-width: 900px;
      margin: 0 auto;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 2rem;
      background: #18181b;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      padding-bottom: 1.5rem;
      margin-bottom: 2rem;
    }
    .logo {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #86efac, #7dd3fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: #71717a;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .stat {
      background: #27272a;
      border-radius: 8px;
      padding: 1rem;
      border: 1px solid rgba(255,255,255,0.05);
    }
    .stat-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: #a1a1aa;
      margin-bottom: 0.5rem;
    }
    .stat-value {
      font-size: 1.5rem;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }
    .signature-box {
      background: #09090b;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      word-break: break-all;
      color: #86efac;
    }
    .footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(255,255,255,0.1);
      font-size: 0.75rem;
      color: #71717a;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="certificate">
    <div class="header">
      <div class="logo">ARKHÉ GENESIS</div>
      <div>
        <div class="title">Audit Certificate</div>
        <div style="font-size:0.875rem; color:#d4d4d8">${reportId}</div>
      </div>
    </div>

    <div class="grid">
      <div class="stat">
        <div class="stat-label">Genome ID</div>
        <div class="stat-value">${genomeId || '—'}</div>
        <div style="font-size:0.75rem; color:#71717a; margin-top:0.25rem">Length: ${genomeLength.toLocaleString()} bp</div>
      </div>
      <div class="stat">
        <div class="stat-label">Active Mutations</div>
        <div class="stat-value">${mutationCount}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Safety Score</div>
        <div class="stat-value" style="color:${safetyScore > 80 ? '#86efac' : safetyScore > 50 ? '#fcd34d' : '#fda4af'}">
          ${safetyScore}%
        </div>
      </div>
    </div>

    <div style="margin-bottom:2rem">
      <div class="stat-label" style="margin-bottom:0.5rem">Protein Fold Delta</div>
      <div style="font-size:1.25rem; font-family:'JetBrains Mono'">
        ${proteinDelta !== null ? proteinDelta.toFixed(3) : '—'}
      </div>
    </div>

    <div>
      <div class="stat-label" style="margin-bottom:0.5rem">Sentinel Seal (SHA‑256)</div>
      <div class="signature-box">
        ${signature}
      </div>
    </div>

    <div class="footer">
      Generated on ${new Date().toLocaleString()} · Signed by Arkhé Sentinel
    </div>
  </div>

  <script>
    window.onload = () => {
      // Auto‑print trigger if called with ?print
      if (window.location.search.includes('print')) {
        window.print();
      }
    };
  </script>
</body>
</html>`;

  return {
    id: reportId,
    timestamp: Date.now(),
    genome: {
      id: genomeId,
      length: genomeLength,
      name: genomeName,
    },
    mutations: mutationCount,
    safetyScore,
    proteinDelta,
    signature,
    html,
  };
}

/**
 * Opens a new window with the report HTML and triggers the print dialog.
 */
export async function triggerPrint() {
  const report = await generateAuditReport();
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Popup blocked. Please allow popups for this site.');
    return;
  }
  printWindow.document.write(report.html);
  printWindow.document.close();
  // Slight delay to ensure styles load before print
  setTimeout(() => printWindow.print(), 250);
}