/**
 * src/app/api/proxy/ncbi/route.ts
 *
 * ── NCBI SOVEREIGN BRIDGE ──────────────────────────────────────────────────
 *
 * Purpose:
 *   Server-side proxy that forwards FASTA fetch requests to NCBI Entrez
 *   E-utilities.  Eliminates the CORS restriction that blocks direct
 *   browser-to-NCBI calls in production, while keeping the NCBI API
 *   entirely opaque to the client.
 *
 * Contract:
 *   GET /api/proxy/ncbi?id=<accession>
 *
 *   Success   → 200  Content-Type: text/plain  body: raw FASTA text
 *   Not found → 404  Content-Type: text/plain  body: error message
 *   Rate limit→ 429  Content-Type: text/plain  body: error message
 *   Other err → 502  Content-Type: text/plain  body: error message
 *
 * Database routing:
 *   Accessions beginning with NP_ / XP_ / YP_ / WP_ / AP_ → db=protein
 *   All other accessions                                    → db=nuccore
 *
 * Notes:
 *   • No NCBI API key is required for ≤ 3 requests/second.  For higher
 *     throughput, add NCBI_API_KEY to .env.local and append it to the URL.
 *   • The route intentionally does NOT cache responses — genomic data must
 *     always reflect the live NCBI record.
 *   • next.config.ts should mark this route as dynamic so Next.js never
 *     statically pre-renders it.
 */

import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const NCBI_EFETCH_BASE =
  'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';

/** Milliseconds to wait for NCBI before aborting and returning a 502. */
const NCBI_TIMEOUT_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Return a plain-text NextResponse with the given status. */
function textResponse(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Determine the correct Entrez database for a given accession.
 *
 * NCBI protein accession prefixes:
 *   NP_ — RefSeq predicted / curated protein
 *   XP_ — predicted protein (model)
 *   YP_ — protein encoded on a complete genome
 *   WP_ — non-redundant protein
 *   AP_ — protein (DDBJ)
 */
function resolveDatabase(accession: string): 'protein' | 'nuccore' {
  return /^(NP_|XP_|YP_|WP_|AP_)/i.test(accession) ? 'protein' : 'nuccore';
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── 1. Extract and validate the `id` query parameter ─────────────────────
  const { searchParams } = new URL(request.url);
  const rawId = searchParams.get('id');

  if (!rawId || rawId.trim().length === 0) {
    return textResponse(
      'Missing required query parameter: id (NCBI accession number).',
      400,
    );
  }

  const accession = rawId.trim().toUpperCase();

  // Basic allowlist: accessions must be alphanumeric plus underscores/dots.
  // This guards against URL-injection via the id parameter.
  if (!/^[A-Z0-9_.]+$/i.test(accession)) {
    return textResponse(
      `Invalid accession format: "${accession}". ` +
        'Only letters, digits, underscores, and dots are permitted.',
      400,
    );
  }

  // ── 2. Construct the NCBI eFetch URL ────────────────────────────────────
  const db  = resolveDatabase(accession);
  const url = new URL(NCBI_EFETCH_BASE);
  url.searchParams.set('db',      db);
  url.searchParams.set('id',      accession);
  url.searchParams.set('rettype', 'fasta');
  url.searchParams.set('retmode', 'text');

  // Optional: append NCBI_API_KEY if set in environment variables.
  // This raises the anonymous rate limit from 3 req/s to 10 req/s.
  const apiKey = process.env.NCBI_API_KEY;
  if (apiKey) {
    url.searchParams.set('api_key', apiKey);
  }

  // ── 3. Fetch from NCBI with a timeout ────────────────────────────────────
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), NCBI_TIMEOUT_MS);

  let ncbiResponse: Response;
  try {
    ncbiResponse = await fetch(url.toString(), {
      method:  'GET',
      headers: { Accept: 'text/plain' },
      signal:  controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === 'AbortError') {
      return textResponse(
        `NCBI Sovereign Bridge timed out after ${NCBI_TIMEOUT_MS / 1000}s ` +
          `for accession "${accession}". NCBI may be temporarily unavailable.`,
        504,
      );
    }

    const msg = err instanceof Error ? err.message : String(err);
    return textResponse(
      `Network error reaching NCBI for accession "${accession}": ${msg}`,
      502,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // ── 4. Pass NCBI error statuses back to the UI ──────────────────────────
  //
  // NCBI returns HTTP 200 with an HTML/plain-text error body for invalid
  // accessions.  A true 404 or 429 from NCBI's infrastructure is passed
  // through so the client can display a precise error message.
  if (ncbiResponse.status === 404) {
    return textResponse(
      `NCBI reported accession "${accession}" not found (HTTP 404). ` +
        'Verify the accession number and database.',
      404,
    );
  }

  if (ncbiResponse.status === 429) {
    return textResponse(
      'NCBI rate limit exceeded (HTTP 429). ' +
        'Please wait a few seconds and try again, ' +
        'or register an NCBI API key to increase the limit.',
      429,
    );
  }

  if (!ncbiResponse.ok) {
    return textResponse(
      `NCBI eFetch returned HTTP ${ncbiResponse.status} ` +
        `for accession "${accession}".`,
      502,
    );
  }

  // ── 5. Read the FASTA body ───────────────────────────────────────────────
  const rawFasta = await ncbiResponse.text();

  // NCBI returns HTTP 200 with an HTML/plain-text error page for invalid
  // accessions (e.g. "Error: No items found.").  Detect this and surface it
  // as a 404 so the UI shows the right message.
  if (!rawFasta.trimStart().startsWith('>')) {
    const preview = rawFasta.slice(0, 200).replace(/\n/g, ' ');
    return textResponse(
      `NCBI returned a non-FASTA response for "${accession}". ` +
        `This usually means the accession is invalid or does not exist. ` +
        `Preview: ${preview}`,
      404,
    );
  }

  // ── 6. Stream the raw FASTA back to the client ──────────────────────────
  return new NextResponse(rawFasta, {
    status:  200,
    headers: {
      'Content-Type':  'text/plain; charset=utf-8',
      // Tell Next.js / CDN never to cache this response.
      'Cache-Control': 'no-store',
      // Expose the resolved accession for client-side Trust Badge usage.
      'X-Arkhe-Accession': accession,
      'X-Arkhe-Database':  db,
    },
  });
}