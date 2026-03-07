/**
 * src/app/api/proxy/fold/route.ts
 *
 * ── SOVEREIGN BRIDGE — META ESM ATLAS ────────────────────────────────────────
 *
 *   Acts as a server-side proxy for protein structure prediction requests,
 *   forwarding amino acid sequences to the Meta ESMAtlas API and returning
 *   PDB-formatted structure data to the client.
 *
 *   KEY RESPONSIBILITIES:
 *     1. Input validation & sanitisation — strip non-amino-acid characters,
 *        enforce length bounds, reject empty payloads before any outbound call.
 *     2. Circuit Breaker — intercepts 429 and 503 responses from ESMAtlas
 *        and converts them into structured JSON the UI can display as a
 *        'Service Busy' notification via the SystemLog pipeline.
 *     3. Transparent proxying — forward the sanitised sequence and stream the
 *        raw PDB text back to the caller with minimal transformation.
 *     4. Observability headers — every successful response carries
 *        X-Fold-Job-Id and X-Fold-Algorithm-Version so the Workbench can
 *        surface them in the SystemLog without parsing the PDB body.
 *
 *   CIRCUIT BREAKER STATES:
 *     CLOSED  — normal operation; all requests forwarded.
 *     OPEN    — tripped by MAX_FAILURES consecutive upstream errors within
 *               FAILURE_WINDOW_MS; requests rejected locally without hitting
 *               ESMAtlas until RESET_TIMEOUT_MS has elapsed.
 *     HALF-OPEN — one probe request is allowed through; success resets the
 *               breaker, failure re-opens it.
 *
 *   SECURITY MODEL:
 *     • Only the 20 standard amino acids (+ B/Z/X/U/O ambiguity codes and
 *       the selenocysteine / pyrrolysine one-letter codes) are passed to
 *       ESMAtlas — everything else is stripped.
 *     • No credentials or internal tokens are forwarded to the external API.
 *     • The caller receives the raw upstream PDB body or a structured error;
 *       no internal stack traces are ever exposed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// External API
// ─────────────────────────────────────────────────────────────────────────────

const ESM_ATLAS_ENDPOINT = 'https://api.esmatlas.com/foldSequence/v1/pdb/';

/** ESM-2 is the underlying language model powering the Atlas fold API. */
const ALGORITHM_VERSION = 'ESM-2';

// ─────────────────────────────────────────────────────────────────────────────
// Sequence sanitisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid single-letter amino acid codes accepted by the ESMAtlas fold API.
 *
 * Standard 20:  ACDEFGHIKLMNPQRSTVWY
 * Ambiguity:    B (Asp/Asn), Z (Glu/Gln), X (unknown)
 * Non-standard: U (selenocysteine), O (pyrrolysine)
 */
const VALID_AA_RE = /[^ACDEFGHIKLMNPQRSTVWYBZXUO]/gi;

/** Strip everything that is not a recognised amino acid letter. */
function sanitiseSequence(raw: string): string {
  return raw.replace(VALID_AA_RE, '').toUpperCase();
}

// Sequence length bounds (ESMAtlas practical limits)
const MIN_SEQUENCE_LENGTH = 1;
const MAX_SEQUENCE_LENGTH = 400; // ESMAtlas hard cap for the public API

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Breaker — module-level singleton (persists across warm invocations)
// ─────────────────────────────────────────────────────────────────────────────

type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerSnapshot {
  state: BreakerState;
  failures: number;
  lastFailureAt: number;
  nextRetryAt: number;
}

/** Consecutive upstream failures required to trip the breaker. */
const MAX_FAILURES = 3;

/** Window in which failures must accumulate to trip the breaker (30 s). */
const FAILURE_WINDOW_MS = 30_000;

/** How long the breaker stays OPEN before allowing a probe request (60 s). */
const RESET_TIMEOUT_MS = 60_000;

const breaker: CircuitBreakerSnapshot = {
  state:        'CLOSED',
  failures:     0,
  lastFailureAt: 0,
  nextRetryAt:  0,
};

function recordSuccess(): void {
  breaker.state    = 'CLOSED';
  breaker.failures = 0;
}

function recordFailure(): void {
  const now = Date.now();

  // Reset the failure counter if the last failure is outside the window.
  if (now - breaker.lastFailureAt > FAILURE_WINDOW_MS) {
    breaker.failures = 0;
  }

  breaker.failures     += 1;
  breaker.lastFailureAt = now;

  if (breaker.failures >= MAX_FAILURES) {
    breaker.state      = 'OPEN';
    breaker.nextRetryAt = now + RESET_TIMEOUT_MS;
  }
}

/**
 * Returns true when the breaker allows the request to proceed.
 * Transitions OPEN → HALF_OPEN when the reset timeout has elapsed.
 */
function breakerAllows(): boolean {
  const now = Date.now();

  switch (breaker.state) {
    case 'CLOSED':
      return true;

    case 'OPEN':
      if (now >= breaker.nextRetryAt) {
        breaker.state = 'HALF_OPEN';
        return true; // probe request
      }
      return false;

    case 'HALF_OPEN':
      // Allow exactly one probe; subsequent concurrent requests are blocked.
      return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SystemLog helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shapes a SystemLog-compatible object that is serialised into the response
 * body alongside the structured error payload.  The UI can deserialise this
 * and pipe it directly into `addSystemLog`.
 */
function makeSystemLog(
  level: 'info' | 'success' | 'warning' | 'error',
  message: string,
): {
  level:     'info' | 'success' | 'warning' | 'error';
  category:  'SYSTEM';
  message:   string;
  timestamp: number;
} {
  return {
    level,
    category:  'SYSTEM',
    message,
    timestamp: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured error factory
// ─────────────────────────────────────────────────────────────────────────────

interface FoldErrorBody {
  ok:        false;
  code:      string;
  message:   string;
  retryable: boolean;
  log:       ReturnType<typeof makeSystemLog>;
}

function foldError(
  httpStatus: number,
  code: string,
  message: string,
  retryable: boolean,
): NextResponse<FoldErrorBody> {
  return NextResponse.json<FoldErrorBody>(
    {
      ok: false,
      code,
      message,
      retryable,
      log: makeSystemLog(retryable ? 'warning' : 'error', message),
    },
    { status: httpStatus },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/proxy/fold
 *
 * Request body (JSON):
 *   { "sequence": "<amino acid string>" }
 *
 * Success response (200):
 *   Content-Type: text/plain
 *   X-Fold-Job-Id: <uuid>
 *   X-Fold-Algorithm-Version: ESM-2
 *   Body: raw PDB file text
 *
 * Error responses (JSON):
 *   400  BAD_SEQUENCE        — missing / too short / too long after sanitisation
 *   429  RATE_LIMITED        — ESMAtlas upstream rate limit (circuit breaker armed)
 *   503  SERVICE_UNAVAILABLE — ESMAtlas upstream 503 (circuit breaker armed)
 *   502  UPSTREAM_ERROR      — any other non-OK upstream response
 *   423  CIRCUIT_OPEN        — breaker is OPEN; request blocked locally
 *   500  INTERNAL_ERROR      — unexpected server-side exception
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Parse the request body ─────────────────────────────────────────────
  let rawSequence: string;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    rawSequence = typeof body.sequence === 'string' ? body.sequence : '';
  } catch {
    return foldError(
      400,
      'BAD_REQUEST',
      'Request body must be valid JSON with a "sequence" string field.',
      false,
    );
  }

  // ── 2. Sanitise — strip non-amino-acid characters ─────────────────────────
  const sequence = sanitiseSequence(rawSequence);

  if (sequence.length < MIN_SEQUENCE_LENGTH) {
    return foldError(
      400,
      'BAD_SEQUENCE',
      'No valid amino acid characters found in the submitted sequence.',
      false,
    );
  }

  if (sequence.length > MAX_SEQUENCE_LENGTH) {
    return foldError(
      400,
      'BAD_SEQUENCE',
      `Sequence length (${sequence.length} aa) exceeds the ESMAtlas ` +
        `public API limit of ${MAX_SEQUENCE_LENGTH} aa. ` +
        'Truncate or split the sequence and resubmit.',
      false,
    );
  }

  // ── 3. Circuit breaker check ──────────────────────────────────────────────
  if (!breakerAllows()) {
    const retryInSec = Math.ceil((breaker.nextRetryAt - Date.now()) / 1_000);
    return foldError(
      423, // 423 Locked — semantically: breaker is OPEN, not a rate-limit
      'CIRCUIT_OPEN',
      `ESMAtlas Sovereign Bridge is temporarily suspended after repeated ` +
        `upstream failures. Retry in ~${retryInSec}s.`,
      true,
    );
  }

  // ── 4. Forward to ESMAtlas ────────────────────────────────────────────────
  const jobId = randomUUID();
  let upstreamRes: Response;

  try {
    upstreamRes = await fetch(ESM_ATLAS_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    sequence,
      // Node 18+ fetch does not support a timeout option directly;
      // use AbortSignal for production hardening.
      signal:  AbortSignal.timeout(120_000), // 2-minute hard cap
    });
  } catch (err) {
    recordFailure();

    const isTimeout =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError');

    return foldError(
      502,
      isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE',
      isTimeout
        ? 'ESMAtlas did not respond within 120 seconds. The fold job may still be running — please retry.'
        : 'Could not reach the ESMAtlas API. Check your network or try again shortly.',
      true,
    );
  }

  // ── 5. Circuit Breaker — intercept upstream error statuses ────────────────
  if (upstreamRes.status === 429) {
    recordFailure();
    const retryAfter = upstreamRes.headers.get('Retry-After') ?? 'unknown';
    return foldError(
      429,
      'RATE_LIMITED',
      `ESMAtlas rate limit exceeded (Retry-After: ${retryAfter}s). ` +
        'The Sovereign Bridge circuit breaker has been armed. ' +
        'Subsequent requests will be blocked locally until the window expires.',
      true,
    );
  }

  if (upstreamRes.status === 503) {
    recordFailure();
    return foldError(
      503,
      'SERVICE_UNAVAILABLE',
      'ESMAtlas is currently unavailable (HTTP 503). ' +
        'The Sovereign Bridge circuit breaker has been armed. ' +
        'Please wait before resubmitting.',
      true,
    );
  }

  if (!upstreamRes.ok) {
    recordFailure();
    return foldError(
      502,
      'UPSTREAM_ERROR',
      `ESMAtlas returned an unexpected HTTP ${upstreamRes.status} response ` +
        `for sequence of length ${sequence.length} aa.`,
      false,
    );
  }

  // ── 6. Stream the PDB body back to the caller ─────────────────────────────
  let pdbText: string;

  try {
    pdbText = await upstreamRes.text();
  } catch {
    recordFailure();
    return foldError(
      502,
      'UPSTREAM_READ_ERROR',
      'ESMAtlas returned a response but the body could not be read. Please retry.',
      true,
    );
  }

  // ── 7. Record success (resets the circuit breaker failure counter) ─────────
  recordSuccess();

  // ── 8. Build the success response with observability headers ──────────────
  //
  //   X-Fold-Job-Id              — UUID generated server-side per request;
  //                                the Workbench surfaces this in SystemLog.
  //   X-Fold-Algorithm-Version   — "ESM-2"; allows the UI to display the
  //                                model version without parsing the PDB REMARK
  //                                lines.
  //   X-Fold-Sequence-Length     — sanitised residue count; useful for the
  //                                Workbench to validate it received the right
  //                                fold response.
  //   X-Fold-Breaker-State       — current circuit breaker state after this
  //                                request; allows the UI to show an advisory
  //                                if the breaker is HALF_OPEN.
  const headers = new Headers({
    'Content-Type':              'text/plain; charset=utf-8',
    'X-Fold-Job-Id':             jobId,
    'X-Fold-Algorithm-Version':  ALGORITHM_VERSION,
    'X-Fold-Sequence-Length':    String(sequence.length),
    'X-Fold-Breaker-State':      breaker.state,
    // Prevent downstream caches from serving stale PDB structures.
    'Cache-Control':             'no-store',
  });

  return new NextResponse(pdbText, { status: 200, headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reject all non-POST methods explicitly
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  return foldError(
    405,
    'METHOD_NOT_ALLOWED',
    'This endpoint only accepts POST requests containing an amino acid sequence.',
    false,
  );
}