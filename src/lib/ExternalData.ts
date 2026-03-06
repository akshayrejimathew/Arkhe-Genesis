/**
 * src/lib/ExternalData.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SPRINT B — TASK 1: External Biological Database Bridge
 *
 * Provides two primary fetch functions:
 *   fetchFromNCBI(accession)  — NCBI Entrez E-utilities (eFetch, FASTA)
 *   fetchFromUniProt(id)      — UniProt REST API v2 (FASTA + JSON annotations)
 *
 * Also exports:
 *   detectIdType(id)          — heuristic to route a bare ID to the correct DB
 *   sequenceToFastaFile(...)  — wraps a raw sequence into a browser File for
 *                               store.loadFile() ingestion
 *   SourceTracker             — lightweight reactive singleton carrying the
 *                               current sequence provenance.  Consumed by
 *                               Workbench.tsx for the "Trust Badge" UI without
 *                               requiring Zustand store changes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * API ENDPOINTS
 * ─────────────────────────────────────────────────────────────────────────────
 *  NCBI Entrez eFetch (no key needed for ≤3 req/s; register for 10 req/s):
 *    https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi
 *      ?db=nuccore|protein&id=<acc>&rettype=fasta&retmode=text
 *
 *  UniProt REST v2:
 *    FASTA:  https://rest.uniprot.org/uniprotkb/<id>.fasta
 *    JSON:   https://rest.uniprot.org/uniprotkb/<id>.json   (annotations)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// § Types
// ─────────────────────────────────────────────────────────────────────────────

/** Provenance descriptor attached to every loaded sequence. */
export interface SequenceSource {
  /** Originating data store. */
  type: 'ncbi' | 'uniprot' | 'file' | 'manual';
  /** Accession number, filename, or mutation description. */
  id: string;
  /** Human-readable string shown in the Trust Badge. */
  label: string;
}

/** Record returned by fetchFromNCBI. */
export interface NCBIResult {
  /** Normalised accession (version stripped if unneeded). */
  accession: string;
  /** Full FASTA description line (without the leading ›). */
  description: string;
  /** Uppercase nucleotide or amino-acid sequence, whitespace stripped. */
  sequence: string;
  /** Sequence length in bp or aa. */
  length: number;
  /** Raw FASTA text as received — kept for audit purposes. */
  rawFasta: string;
}

/** Functional annotation entry from UniProt. */
export interface UniProtAnnotation {
  type: string;
  description: string;
}

/** Record returned by fetchFromUniProt. */
export interface UniProtResult {
  /** UniProt accession (e.g. "P69905"). */
  id: string;
  /** Recommended protein name. */
  name: string;
  /** Source organism (scientific name). */
  organism: string;
  /** Uppercase amino-acid sequence, whitespace stripped. */
  sequence: string;
  /** Sequence length in aa. */
  length: number;
  /** Functional comments from UniProt JSON. */
  annotations: UniProtAnnotation[];
  /** Raw FASTA text as received. */
  rawFasta: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// § SourceTracker — reactive provenance singleton
//
// A minimal pub/sub store for sequence provenance.  Decouples ExternalData
// from the Zustand store so no slice-level changes are required.
//
// Usage in a component:
//
//   const [src, setSrc] = useState(SourceTracker.get());
//   useEffect(() => SourceTracker.subscribe(setSrc), []);
// ─────────────────────────────────────────────────────────────────────────────

type SourceListener = (source: SequenceSource | null) => void;

let _currentSource: SequenceSource | null = null;
const _listeners = new Set<SourceListener>();

export const SourceTracker = {
  /** Synchronous read — safe to call during component initialisation. */
  get(): SequenceSource | null {
    return _currentSource;
  },

  /**
   * Set provenance and notify all active subscribers.
   * Called by terminalParser.ts (on successful NCBI/UniProt fetch) and by
   * Workbench.tsx's handleFileChange (on local file ingestion).
   */
  set(source: SequenceSource | null): void {
    _currentSource = source;
    _listeners.forEach(l => l(source));
  },

  /**
   * Subscribe to provenance changes.
   * Returns an unsubscribe function — pass directly to useEffect cleanup.
   */
  subscribe(listener: SourceListener): () => void {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  },

  /**
   * Mark the current sequence as manually modified.
   * Preserves the original accession in the label for audit traceability.
   */
  markMutated(): void {
    const prev = _currentSource;
    SourceTracker.set({
      type: 'manual',
      id: prev?.id ?? 'unknown',
      label: prev ? `MUTATED (was ${prev.id})` : 'UNVALIDATED DRAFT',
    });
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// § ID Type Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a bare ID string into one of three routing targets:
 *   'ncbi'    — RefSeq / GenBank accession (e.g. NC_000913.3, AY123456)
 *   'uniprot' — UniProt accession (e.g. P69905, Q8I6T1)
 *   'cloud'   — Arkhé internal genome ID → falls through to loadGenomeFromCloud
 *
 * Reference:
 *   NCBI accession formats: https://www.ncbi.nlm.nih.gov/books/NBK21091/
 *   UniProt format:         https://www.uniprot.org/help/accession_numbers
 */
export function detectIdType(id: string): 'ncbi' | 'uniprot' | 'cloud' {
  const s = id.trim().toUpperCase();

  // ── RefSeq: 2 uppercase letters + underscore + 6+ digits (optional .version)
  //    e.g. NC_000913.3, NM_001234567, XP_123456789
  if (/^[A-Z]{1,2}_\d{4,}(\.\d+)?$/.test(s)) return 'ncbi';

  // ── GenBank: 1-2 letters + 5-8 digits (optional .version)
  //    e.g. AY123456.1, AF302779, U12345
  if (/^[A-Z]{1,2}\d{5,8}(\.\d+)?$/.test(s)) return 'ncbi';

  // ── WGS / large-scale: 4 letters + 8+ digits
  //    e.g. AAAA01000001
  if (/^[A-Z]{4}\d{8,}$/.test(s)) return 'ncbi';

  // ── UniProt: strict 6-char format
  //    Pattern: [OPQ][0-9][A-Z0-9]{3}[0-9]  (reviewed Swiss-Prot)
  if (/^[OPQ][0-9][A-Z0-9]{3}[0-9]$/.test(s)) return 'uniprot';
  //    Pattern: [A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}
  if (/^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/.test(s)) return 'uniprot';

  return 'cloud';
}

// ─────────────────────────────────────────────────────────────────────────────
// § NCBI Entrez eFetch
// ─────────────────────────────────────────────────────────────────────────────

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/**
 * Fetch a nucleotide or protein record from NCBI Entrez E-utilities via FASTA.
 *
 * Database routing:
 *   NP_ / XP_ / YP_ / WP_ / AP_ prefixes → db=protein
 *   Everything else                        → db=nuccore
 *
 * @throws  If the HTTP request fails or the response is not valid FASTA.
 *          NCBI returns HTTP 200 with an HTML error body for invalid IDs —
 *          this is detected and surfaced as an Error.
 */
export async function fetchFromNCBI(accession: string): Promise<NCBIResult> {
  const clean = accession.trim().toUpperCase();

  const isProtein = /^(NP_|XP_|YP_|WP_|AP_)/.test(clean);
  const db = isProtein ? 'protein' : 'nuccore';

  const url =
    `${NCBI_BASE}/efetch.fcgi` +
    `?db=${db}` +
    `&id=${encodeURIComponent(clean)}` +
    `&rettype=fasta` +
    `&retmode=text`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/plain' },
    });
  } catch (networkErr) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(`Network error reaching NCBI: ${msg}`);
  }

  if (!response.ok) {
    throw new Error(
      `NCBI eFetch HTTP ${response.status} for accession "${accession}". ` +
      `Verify the accession format (e.g. NC_000913.3).`,
    );
  }

  const rawFasta = await response.text();

  // NCBI returns 200 with an HTML/plain-text error page for invalid accessions
  if (!rawFasta.trimStart().startsWith('>')) {
    const preview = rawFasta.slice(0, 140).replace(/\n/g, ' ');
    throw new Error(
      `NCBI returned a non-FASTA response for "${accession}". ` +
      `Is this a valid accession? Preview: ${preview}`,
    );
  }

  return _parseFasta(rawFasta, clean);
}

/**
 * Parse a raw FASTA string into an NCBIResult.
 * Handles multi-line sequences, strips all whitespace from the body.
 */
function _parseFasta(rawFasta: string, fallbackAccession: string): NCBIResult {
  const lines = rawFasta.split('\n');

  const headerLine  = lines[0]?.trim() ?? '';
  const description = headerLine.startsWith('>') ? headerLine.slice(1).trim() : '';

  // Extract canonical accession from the description's first token.
  // NCBI sometimes returns pipe-delimited headers: >gi|xxx|ref|NC_000913.3| ...
  let accession = (description.split(/\s+/)[0] ?? fallbackAccession);
  const refMatch =
    accession.match(/\|ref\|([^|]+)\|/) ??
    accession.match(/\|gb\|([^|]+)\|/)  ??
    accession.match(/\|emb\|([^|]+)\|/);
  if (refMatch) accession = refMatch[1];

  const sequence = lines.slice(1).join('').replace(/\s+/g, '').toUpperCase();

  if (sequence.length === 0) {
    throw new Error(`NCBI returned an empty sequence body for "${fallbackAccession}".`);
  }

  return {
    accession: accession || fallbackAccession,
    description,
    sequence,
    length: sequence.length,
    rawFasta,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § UniProt REST API
// ─────────────────────────────────────────────────────────────────────────────

const UNIPROT_BASE = 'https://rest.uniprot.org/uniprotkb';

/**
 * Fetch a protein record from UniProt REST API v2.
 *
 * Two requests are fired in parallel:
 *   1. FASTA  — required (sequence)
 *   2. JSON   — best-effort (name, organism, functional annotations)
 *
 * A JSON failure degrades gracefully: metadata is extracted from the FASTA
 * header and annotations are left empty.
 *
 * @throws  If the FASTA request fails or returns non-FASTA content.
 */
export async function fetchFromUniProt(id: string): Promise<UniProtResult> {
  const clean = id.trim().toUpperCase();

  const fastaUrl = `${UNIPROT_BASE}/${encodeURIComponent(clean)}.fasta`;
  const jsonUrl  = `${UNIPROT_BASE}/${encodeURIComponent(clean)}.json`;

  let fastaResponse: Response;
  let jsonResponse: Response | null;

  try {
    [fastaResponse, jsonResponse] = await Promise.all([
      fetch(fastaUrl, { headers: { Accept: 'text/plain' } }),
      fetch(jsonUrl,  { headers: { Accept: 'application/json' } }).catch(() => null),
    ]);
  } catch (networkErr) {
    const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new Error(`Network error reaching UniProt: ${msg}`);
  }

  if (!fastaResponse.ok) {
    throw new Error(
      `UniProt API HTTP ${fastaResponse.status} for ID "${id}". ` +
      `Verify the accession (e.g. P69905, Q8I6T1).`,
    );
  }

  const rawFasta = await fastaResponse.text();

  if (!rawFasta.trimStart().startsWith('>')) {
    throw new Error(`UniProt returned unexpected non-FASTA data for "${id}".`);
  }

  // Parse FASTA
  const fastaLines = rawFasta.split('\n');
  const header     = fastaLines[0].slice(1).trim();
  const sequence   = fastaLines.slice(1).join('').replace(/\s+/g, '').toUpperCase();

  if (sequence.length === 0) {
    throw new Error(`UniProt returned empty sequence for "${id}".`);
  }

  // Extract metadata from FASTA header as fallback
  // UniProt FASTA header format:
  //   >db|UniqueIdentifier|EntryName ProteinName OS=Organism OX=... GN=... PE=... SV=...
  let name     = header;
  let organism = 'Unknown organism';

  const osMatch   = header.match(/\bOS=(.+?)(?:\s+OX=|\s+GN=|\s+PE=|\s*$)/);
  const nameMatch = header.match(/^\S+ \S+ (.+?) OS=/);
  if (osMatch)   organism = osMatch[1].trim();
  if (nameMatch) name     = nameMatch[1].trim();

  // Parse JSON for richer metadata (best-effort)
  const annotations: UniProtAnnotation[] = [];

  if (jsonResponse?.ok) {
    try {
      const json = (await jsonResponse.json()) as UniProtJsonPayload;

      if (json.organism?.scientificName) {
        organism = json.organism.scientificName;
      }
      if (json.proteinDescription?.recommendedName?.fullName?.value) {
        name = json.proteinDescription.recommendedName.fullName.value;
      }
      if (Array.isArray(json.comments)) {
        for (const comment of json.comments) {
          if (comment.commentType && comment.texts?.[0]?.value) {
            annotations.push({
              type: comment.commentType,
              description: comment.texts[0].value,
            });
          }
        }
      }
    } catch {
      // JSON parse failure is non-fatal; FASTA-derived metadata is sufficient
    }
  }

  return {
    id: clean,
    name,
    organism,
    sequence,
    length: sequence.length,
    annotations,
    rawFasta,
  };
}

// Internal shape of the UniProt JSON response (trimmed to fields we use)
interface UniProtJsonPayload {
  organism?:           { scientificName?: string };
  proteinDescription?: { recommendedName?: { fullName?: { value?: string } } };
  comments?:           Array<{
    commentType?: string;
    texts?:       Array<{ value?: string }>;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Utility — sequence → FASTA File
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a raw sequence string in FASTA format and return a browser `File`.
 *
 * Used by terminalParser.ts to create a File suitable for store.loadFile(),
 * which expects a `File` object for worker streaming.
 *
 * @param sequence  Uppercase nucleotide or amino-acid sequence.
 * @param header    FASTA description (without the leading ›).
 * @param filename  Name for the resulting File object (used as genome label).
 */
export function sequenceToFastaFile(
  sequence: string,
  header: string,
  filename: string,
): File {
  // Wrap sequence at 60 characters per line (FASTA convention)
  const wrapped = sequence.match(/.{1,60}/g)?.join('\n') ?? sequence;
  const fasta   = `>${header}\n${wrapped}\n`;
  return new File([fasta], filename, { type: 'text/plain' });
}