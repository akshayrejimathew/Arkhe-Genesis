// src/lib/proteinFold.ts
/**
 * proteinFold.ts
 *
 * Protein folding prediction using ESM Atlas API with:
 *   - Correct AbortController (signal passed to fetch, timeout cleared in finally)
 *   - Explicit 429 / rate-limit handling with user-facing rateLimitNotice
 *   - GDPR prior-consent gate — ESM Atlas is NOT called unless consentObtained === true
 *   - Graceful fallback to local Chou-Fasman heuristic on any failure or denied consent
 *   - method + warning fields for scientific transparency in the UI
 *
 * AUDIT III FIXES APPLIED:
 *   SHADOW-04 — Removed local `interface ProteinFold`. ProteinFold is now
 *               imported exclusively from '@/types/arkhe'. This eliminates the
 *               dual-definition divergence that caused the unsafe cast in
 *               ProteinViewport.tsx.
 *
 *   GDPR     — computeProteinFold() now accepts a `consentObtained: boolean`
 *               second argument. The ESM Atlas API MUST NOT be called unless
 *               this flag is true. When false, the function immediately falls
 *               back to the Chou-Fasman heuristic without any network I/O.
 *               Callers (e.g. useArkheStore.foldProtein) are responsible for
 *               obtaining and passing prior informed consent.
 *
 *   Vector F — AbortController: signal is passed to fetch; timeout is cleared
 *               in the finally block so it can never leak.
 *   Vector F — 429 handled explicitly; caller receives a result object whose
 *               rateLimitNotice field drives the orange UI notice.
 *   Vector F — method and warning fields populated on every code path.
 */

import type { ProteinFold } from '@/types/arkhe';
import BioLogic from './BioLogic';

// ── Internal types ────────────────────────────────────────────────────────────

/** Reason the ESM Atlas call did not produce a result. */
type ESMFailureReason =
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'parse_error'
  | 'api_error'
  | 'consent_not_given';

interface ESMAtlasResult {
  coordinates: Array<{ x: number; y: number; z: number }>;
  secondaryStructure: Array<'alpha' | 'beta' | 'coil'>;
  confidence: number[];
}

interface ESMAtlasFailure {
  success: false;
  reason: ESMFailureReason;
  httpStatus?: number;
  message: string;
}

interface ESMAtlasSuccess {
  success: true;
  data: ESMAtlasResult;
}

type ESMAtlasOutcome = ESMAtlasSuccess | ESMAtlasFailure;

// ── Constants ─────────────────────────────────────────────────────────────────

const ESM_ATLAS_URL     = 'https://api.esmatlas.com/foldSequence/v1/pdb/';
const ESM_TIMEOUT_MS    = 30_000;
const CLINICAL_WARNING  = 'Heuristic prediction — Not for clinical use.';
const GDPR_DISCLOSURE   = 'Amino-acid sequence transmitted to ESMfold (Meta Research) for structure prediction.';
const RATE_LIMIT_NOTICE = 'ESMfold rate limit reached. Falling back to heuristic analysis.';
const CONSENT_NOTICE    = 'ESM Atlas folding requires prior user consent. Falling back to heuristic analysis.';

// ── Translation ───────────────────────────────────────────────────────────────

function translateDNAtoAA(dna: string): string {
  const encoder = new TextEncoder();
  const buffer  = encoder.encode(dna);
  return BioLogic.translateFrame(buffer, 0);
}

// ── ESM Atlas API call ────────────────────────────────────────────────────────

/**
 * Attempt to fold a protein via ESM Atlas.
 *
 * Guarantees:
 *   1. `signal` is always passed to fetch so the request is actually abortable.
 *   2. `clearTimeout` always runs via `finally` — the timer can never leak.
 *   3. HTTP 429 returns a typed failure (not a thrown exception) so the caller
 *      can distinguish rate-limiting from other errors and show the right UI.
 *   4. Only called after consentObtained === true has been verified by the
 *      public entry point. This function itself is not exported.
 */
async function callESMAtlas(aminoAcids: string): Promise<ESMAtlasOutcome> {
  const controller = new AbortController();
  let   timeoutId: ReturnType<typeof setTimeout> | undefined;

  // Set the abort timer BEFORE fetch so the timeout cannot be skipped even if
  // the fetch itself takes time to initiate.
  timeoutId = setTimeout(() => {
    controller.abort(
      new DOMException('ESM Atlas request timed out after 30 s.', 'TimeoutError')
    );
  }, ESM_TIMEOUT_MS);

  try {
    const response = await fetch(ESM_ATLAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `sequence=${encodeURIComponent(aminoAcids)}`,
      signal:  controller.signal, // ← REQUIRED: makes the abort actually work
    });

    // ── 429 Rate Limit ────────────────────────────────────────────────────
    if (response.status === 429) {
      return {
        success:    false,
        reason:     'rate_limited',
        httpStatus: 429,
        message:    RATE_LIMIT_NOTICE,
      };
    }

    // ── Other non-2xx ─────────────────────────────────────────────────────
    if (!response.ok) {
      return {
        success:    false,
        reason:     'api_error',
        httpStatus: response.status,
        message:    `ESM Atlas returned HTTP ${response.status}`,
      };
    }

    // ── Parse response ────────────────────────────────────────────────────
    let data: ESMAtlasResult;
    try {
      const json = await response.json();
      data = {
        coordinates:        json.coordinates        ?? [],
        secondaryStructure: json.secondaryStructure ?? [],
        confidence:         json.confidence         ?? [],
      };
    } catch {
      return {
        success: false,
        reason:  'parse_error',
        message: 'ESM Atlas response could not be parsed.',
      };
    }

    return { success: true, data };

  } catch (err: unknown) {
    // AbortError covers both our manual timeout abort AND any upstream signal.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        success: false,
        reason:  'timeout',
        message: `ESM Atlas request timed out after ${ESM_TIMEOUT_MS / 1000} s.`,
      };
    }
    return {
      success: false,
      reason:  'network_error',
      message: err instanceof Error ? err.message : 'Unknown network error.',
    };
  } finally {
    // Runs unconditionally — success, exception, or abort. Timer never leaks.
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

// ── Worker system log ─────────────────────────────────────────────────────────

function postSystemLog(message: string, level: 'info' | 'warning' | 'error') {
  if (typeof self !== 'undefined' && typeof (self as Window).postMessage === 'function') {
    (self as Window).postMessage({
      type:    'SYSTEM_LOG',
      payload: { timestamp: Date.now(), category: 'FOLD', message, level },
    });
  }
}

// ── Main exported entry point ─────────────────────────────────────────────────

/**
 * Compute a protein fold for the given DNA sequence.
 *
 * @param dna             - Raw DNA string to translate and fold.
 * @param consentObtained - MUST be `true` for ESM Atlas to be called. When
 *                          `false` the function immediately returns a heuristic
 *                          result with `rateLimitNotice` set to explain why,
 *                          and NO network request is made. This satisfies the
 *                          GDPR prior-consent requirement: sequence data must
 *                          never be transmitted to a third party without the
 *                          researcher's explicit prior agreement.
 *
 * Resolution order:
 *   1. If consentObtained === false → heuristic (no network I/O)
 *   2. ESM Atlas API (30-second timeout, 429-aware)
 *   3. Local Chou-Fasman heuristic (always available, always labelled)
 *
 * The returned ProteinFold always carries `method` and, when heuristic,
 * `warning` — so ProteinViewport can always render the correct badge.
 */
export async function computeProteinFold(
  dna: string,
  consentObtained: boolean = false,
): Promise<ProteinFold> {
  const aminoAcids = translateDNAtoAA(dna);

  // ── GDPR gate: do NOT transmit sequence data without prior consent ─────────
  if (!consentObtained) {
    postSystemLog(CONSENT_NOTICE, 'warning');

    const heuristic = generateChouFasmanFold(aminoAcids);
    return {
      ...heuristic,
      method:          'CHOU_FASMAN_HEURISTIC',
      warning:         CLINICAL_WARNING,
      rateLimitNotice: CONSENT_NOTICE,
    };
  }

  // ── Attempt ESM Atlas ─────────────────────────────────────────────────────
  const outcome = await callESMAtlas(aminoAcids);

  if (outcome.success) {
    postSystemLog(GDPR_DISCLOSURE, 'info');

    return {
      aminoAcids,
      coordinates:        outcome.data.coordinates,
      secondaryStructure: outcome.data.secondaryStructure,
      confidence:         outcome.data.confidence,
      method:             'ESM_ATLAS',
      disclosure:         GDPR_DISCLOSURE,
    };
  }

  // ── ESM Atlas failed — choose the right user-facing notice ────────────────
  let rateLimitNotice: string | undefined;

  switch (outcome.reason) {
    case 'rate_limited':
      rateLimitNotice = RATE_LIMIT_NOTICE;
      postSystemLog(RATE_LIMIT_NOTICE, 'warning');
      break;

    case 'timeout':
      postSystemLog(
        `ESM Atlas timed out after ${ESM_TIMEOUT_MS / 1000} s — using heuristic fallback.`,
        'warning'
      );
      break;

    case 'network_error':
    case 'api_error':
    case 'parse_error':
    default:
      postSystemLog(
        `ESM Atlas unavailable (${outcome.message}) — using heuristic fallback.`,
        'warning'
      );
      break;
  }

  // ── Heuristic fallback ────────────────────────────────────────────────────
  const heuristic = generateChouFasmanFold(aminoAcids);
  return {
    ...heuristic,
    method:          'CHOU_FASMAN_HEURISTIC',
    warning:         CLINICAL_WARNING,
    rateLimitNotice,
  };
}

// ── Local Chou-Fasman simulation ──────────────────────────────────────────────

/**
 * Generates a heuristic fold using Chou-Fasman propensity tables.
 *
 * Returns only the fields that the caller (computeProteinFold) will spread
 * before adding `method`, `warning`, and `rateLimitNotice`. This keeps the
 * internal helper free of decision logic about provenance labelling.
 *
 * Non-standard residues:
 *   '*' (stop codon) and 'X' (unknown) default to propensity 0.5 for both
 *   helix and strand, producing 'coil' with confidence 0.5. This is a
 *   conservative assignment — unknown residues are not predicted as structured.
 */
function generateChouFasmanFold(
  aminoAcids: string,
): Omit<ProteinFold, 'method' | 'warning' | 'rateLimitNotice' | 'disclosure'> {
  const length = aminoAcids.length;

  if (length === 0) {
    return { aminoAcids: '', coordinates: [], secondaryStructure: [], confidence: [] };
  }

  // Chou-Fasman propensity tables (Chou & Fasman, 1978)
  const helixPropensity: Record<string, number> = {
    A: 1.45, R: 0.98, N: 0.67, D: 0.67, C: 0.70,
    Q: 1.11, E: 1.51, G: 0.57, H: 1.00, I: 1.08,
    L: 1.21, K: 1.16, M: 1.45, F: 1.13, P: 0.57,
    S: 0.77, T: 0.83, W: 1.08, Y: 0.69, V: 1.06,
    '*': 0.0, X: 0.5,
  };

  const strandPropensity: Record<string, number> = {
    A: 0.97, R: 0.93, N: 0.89, D: 0.89, C: 1.19,
    Q: 1.10, E: 0.37, G: 0.75, H: 0.87, I: 1.60,
    L: 1.30, K: 0.74, M: 1.05, F: 1.38, P: 0.55,
    S: 0.75, T: 1.19, W: 1.37, Y: 1.47, V: 1.70,
    '*': 0.0, X: 0.5,
  };

  const secondaryStructure: Array<'alpha' | 'beta' | 'coil'> = [];
  const confidence: number[] = [];

  for (let i = 0; i < length; i++) {
    const aa          = aminoAcids[i];
    const helixScore  = helixPropensity[aa]  ?? 0.5;
    const strandScore = strandPropensity[aa] ?? 0.5;
    const total       = helixScore + strandScore + 0.1;

    const pHelix  = helixScore  / total;
    const pStrand = strandScore / total;

    if (pHelix > 0.55) {
      secondaryStructure.push('alpha');
      confidence.push(pHelix);
    } else if (pStrand > 0.55) {
      secondaryStructure.push('beta');
      confidence.push(pStrand);
    } else {
      secondaryStructure.push('coil');
      confidence.push(0.5);
    }
  }

  // Parametric backbone trace (helix, strand, coil have distinct geometry)
  const coordinates: Array<{ x: number; y: number; z: number }> = [];
  let angle = 0;
  let z     = 0;

  for (let i = 0; i < length; i++) {
    let radius: number;
    let pitch:  number;

    switch (secondaryStructure[i]) {
      case 'alpha': radius = 2.3; pitch = 1.5; angle += 0.50; break;
      case 'beta':  radius = 3.5; pitch = 3.5; angle += 0.30; break;
      default:      radius = 3.0; pitch = 2.0; angle += 0.40; break;
    }

    coordinates.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
      z: (z += pitch),
    });
  }

  return { aminoAcids, coordinates, secondaryStructure, confidence };
}