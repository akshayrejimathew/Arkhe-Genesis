/**
 * src/lib/RegistryResolver.ts
 *
 * ── SOVEREIGN BRIDGE SPRINT — SCIENTIFIC DISPATCHER ──────────────────────────
 *
 *   RegistryResolver is the single-entry-point for all external accession ID
 *   resolution in Arkhé.  It classifies an accession string against a set of
 *   known genomic / proteomic registries, validates the ID (including checksum
 *   where the registry specification requires one), and dispatches the fetch to
 *   the correct server-side Sovereign Bridge proxy.
 *
 *   SUPPORTED REGISTRIES
 *   ────────────────────
 *   ┌──────────────┬───────────────────────────────┬──────────────────────────┐
 *   │ Registry     │ Example ID                    │ Proxy route              │
 *   ├──────────────┼───────────────────────────────┼──────────────────────────┤
 *   │ NCBI RefSeq  │ NC_000913.3, NM_001301717.2   │ /api/proxy/ncbi          │
 *   │ NCBI GenBank │ AY123456, U00096.3             │ /api/proxy/ncbi          │
 *   │ UniProt      │ P12345, Q9Y263, A0A000         │ /api/proxy/uniprot       │
 *   │ Ensembl Gene │ ENSG00000139618               │ /api/proxy/ensembl        │
 *   │ Ensembl Tx   │ ENST00000380152               │ /api/proxy/ensembl        │
 *   │ PDB          │ 1ABC, 4HHB                    │ /api/proxy/pdb            │
 *   └──────────────┴───────────────────────────────┴──────────────────────────┘
 *
 *   VALIDATION STRATEGY
 *   ───────────────────
 *   • NCBI: structural pattern validation (prefix + digit count per INSDC spec).
 *   • UniProt: official format regex from UniProt Knowledge Base documentation
 *     (https://www.uniprot.org/help/accession_numbers) — no external checksum.
 *   • Ensembl: prefix + 11 digit body check per Ensembl stable ID spec.
 *   • PDB: exactly 4 characters — digit + 3 alphanumeric.
 *
 *   METADATA CONTRACT
 *   ─────────────────
 *   resolveAccession() resolves to an AccessionMetadata object that the caller
 *   (uiSlice.fetchExternalSequence) merges into store state.  Downstream
 *   consumers (Workbench.tsx, terminal commands) can read the metadata directly
 *   from the store without re-parsing raw FASTA headers.
 *
 *   ERROR MODEL
 *   ──────────
 *   All errors are thrown as RegistryError instances so callers can distinguish
 *   validation failures (no network request) from network / proxy failures and
 *   present appropriate SystemLog messages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** The registry that owns a given accession ID. */
export type RegistryName =
  | 'NCBI_REFSEQ'
  | 'NCBI_GENBANK'
  | 'UNIPROT'
  | 'ENSEMBL_GENE'
  | 'ENSEMBL_TRANSCRIPT'
  | 'PDB';

/** Broad category of the biological molecule. */
export type MoleculeType =
  | 'genomic_dna'
  | 'mrna'
  | 'ncrna'
  | 'protein'
  | 'unknown';

/**
 * Metadata returned by resolveAccession().
 *
 * Designed to be merged directly into the Arkhé store's `currentAccessionMeta`
 * field (UISlice).  Every field is intentionally nullable so consumers can
 * render partial data while a full fetch is still in-flight.
 */
export interface AccessionMetadata {
  /** The original (trimmed, normalised to uppercase) accession string. */
  accession: string;

  /** Which registry this accession belongs to. */
  registry: RegistryName;

  /**
   * Broad molecule type inferred from the accession prefix.
   * Proxy routes may overwrite this with the authoritative value from the
   * registry's response payload (e.g. UniProt `molecule_type` field).
   */
  moleculeType: MoleculeType;

  /**
   * Organism name.
   * Populated from the FASTA/JSON response header parsed on the server side
   * and returned in the `X-Accession-Organism` response header.
   * null until the fetch completes.
   */
  organism: string | null;

  /**
   * Human-readable display name for the record (gene symbol, protein name,
   * etc.).  Populated from response headers; null until fetch completes.
   */
  displayName: string | null;

  /**
   * Sequence length in base pairs (nucleotide records) or amino acids
   * (protein records).  null until populated from the response.
   */
  sequenceLength: number | null;

  /**
   * ISO-8601 timestamp of when this metadata was fetched.
   * Useful for cache invalidation logic in the store.
   */
  fetchedAt: string;

  /**
   * The proxy route that was used to fetch this record.
   * Stored here so the UI can display "via NCBI Sovereign Bridge" etc.
   */
  proxyRoute: string;
}

/** Thrown for any validation or resolution failure. */
export class RegistryError extends Error {
  constructor(
    message: string,
    public readonly code: RegistryErrorCode,
    public readonly accession: string,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

export type RegistryErrorCode =
  | 'UNKNOWN_REGISTRY'       // ID does not match any known pattern
  | 'INVALID_FORMAT'         // Matches a registry pattern but fails format check
  | 'PROXY_HTTP_ERROR'       // Proxy returned a non-OK status
  | 'PROXY_RATE_LIMITED'     // 429 from proxy
  | 'PROXY_NOT_FOUND'        // 404 — record not found in the remote registry
  | 'PROXY_SERVICE_BUSY'     // 503 — remote registry unavailable
  | 'PROXY_CIRCUIT_OPEN'     // 423 — local circuit breaker is open
  | 'RESPONSE_PARSE_ERROR'   // Could not extract metadata from the response
  | 'EMPTY_ID';              // Caller passed an empty string

// ─────────────────────────────────────────────────────────────────────────────
// Internal classification table
// ─────────────────────────────────────────────────────────────────────────────

interface RegistryRule {
  name: RegistryName;
  /**
   * Pre-screen pattern: fast RegExp applied before the heavier validateId()
   * check.  Should be anchored (^ and $) and case-insensitive.
   */
  pattern: RegExp;
  /** Proxy base URL (server-side route). */
  proxyRoute: string;
  /** Default molecule type inferred from this prefix family. */
  defaultMoleculeType: MoleculeType;
  /**
   * Optional deeper validation beyond the regex pattern.
   * Returns true if the id is structurally valid.
   */
  validate?: (id: string) => boolean;
}

/**
 * NCBI RefSeq accession format per INSDC specification:
 *
 *   2-letter prefix + underscore + 6-to-9 digits + optional "." + version
 *
 * Prefixes covered (molecule-typed):
 *   NC_ — complete genomic molecules (chromosomes, plasmids, organelles)
 *   NG_ — incomplete genomic regions
 *   NM_ — mRNA (protein-coding transcripts)
 *   NR_ — non-coding RNA
 *   NP_ — protein product
 *   XM_ — predicted mRNA (Model RefSeq)
 *   XR_ — predicted non-coding RNA
 *   XP_ — predicted protein
 *   NT_ — genomic contig / scaffold
 *   NW_ — genomic contig / scaffold (WGS)
 *   NZ_ — WGS scaffold
 */
const NCBI_REFSEQ_PREFIXES = ['NC', 'NG', 'NM', 'NR', 'NP', 'XM', 'XR', 'XP', 'NT', 'NW', 'NZ'];

const NCBI_REFSEQ_PATTERN = new RegExp(
  `^(${NCBI_REFSEQ_PREFIXES.join('|')})_\\d{6,9}(\\.\\d+)?$`,
  'i',
);

/**
 * NCBI GenBank / EMBL / DDBJ flat-file accessions:
 *   1–3 letters + 5–8 digits (+ optional .version)
 *   This broad pattern captures the INSDC primary accession format.
 */
const NCBI_GENBANK_PATTERN = /^[A-Z]{1,3}\d{5,8}(\.\d+)?$/i;

/**
 * UniProt Knowledge Base accession format.
 * Official regex from https://www.uniprot.org/help/accession_numbers:
 *
 *   [OPQ][0-9][A-Z0-9]{3}[0-9]
 *   |
 *   [A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}
 *
 * Both Swiss-Prot and TrEMBL accessions satisfy this pattern.
 */
const UNIPROT_PATTERN =
  /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;

/**
 * Ensembl stable ID format per Ensembl specification:
 *   ENS[species prefix (0-3 chars)][feature type][11 digits]
 *
 *   G = gene, T = transcript, P = protein, E = exon
 *
 * The species prefix is 0–3 uppercase letters (human has none: ENSG…,
 * mouse has "Mus": ENSMUSG…).
 */
const ENSEMBL_GENE_PATTERN       = /^ENS[A-Z]{0,3}G\d{11}(\.\d+)?$/i;
const ENSEMBL_TRANSCRIPT_PATTERN = /^ENS[A-Z]{0,3}T\d{11}(\.\d+)?$/i;

/**
 * PDB (Protein Data Bank) accession: exactly 4 characters.
 * First character is always a digit (1–9).
 * Remaining 3 are alphanumeric.
 */
const PDB_PATTERN = /^[1-9][A-Z0-9]{3}$/i;

// ─────────────────────────────────────────────────────────────────────────────

function inferNCBIMoleculeType(id: string): MoleculeType {
  const upper = id.toUpperCase();
  if (upper.startsWith('NP_') || upper.startsWith('XP_')) return 'protein';
  if (upper.startsWith('NM_') || upper.startsWith('XM_')) return 'mrna';
  if (upper.startsWith('NR_') || upper.startsWith('XR_')) return 'ncrna';
  return 'genomic_dna';
}

/** Ordered list of registry rules — evaluated top to bottom. */
const REGISTRY_RULES: RegistryRule[] = [
  // ── NCBI RefSeq ─────────────────────────────────────────────────────────────
  {
    name:               'NCBI_REFSEQ',
    pattern:            NCBI_REFSEQ_PATTERN,
    proxyRoute:         '/api/proxy/ncbi',
    defaultMoleculeType: 'genomic_dna',
    validate: (id) => {
      // Strip version suffix before structural check.
      const base = id.replace(/\.\d+$/, '').toUpperCase();
      const [prefix, digits] = base.split('_');
      if (!prefix || !digits) return false;
      const prefixUpper = prefix.toUpperCase();
      if (!NCBI_REFSEQ_PREFIXES.includes(prefixUpper)) return false;
      if (!/^\d{6,9}$/.test(digits)) return false;
      return true;
    },
  },

  // ── NCBI GenBank ────────────────────────────────────────────────────────────
  {
    name:               'NCBI_GENBANK',
    pattern:            NCBI_GENBANK_PATTERN,
    proxyRoute:         '/api/proxy/ncbi',
    defaultMoleculeType: 'genomic_dna',
    validate: (id) => {
      const base = id.replace(/\.\d+$/, '').toUpperCase();
      // Per INSDC spec: 1 letter + 5 digits  OR  2 letters + 6 digits
      //                 OR 3 letters + 5-8 digits  (WGS, etc.)
      return /^[A-Z]{1,3}\d{5,8}$/.test(base);
    },
  },

  // ── UniProt ─────────────────────────────────────────────────────────────────
  {
    name:               'UNIPROT',
    pattern:            UNIPROT_PATTERN,
    proxyRoute:         '/api/proxy/uniprot',
    defaultMoleculeType: 'protein',
    validate:           validateUniProtAccession,
  },

  // ── Ensembl Gene ────────────────────────────────────────────────────────────
  {
    name:               'ENSEMBL_GENE',
    pattern:            ENSEMBL_GENE_PATTERN,
    proxyRoute:         '/api/proxy/ensembl',
    defaultMoleculeType: 'genomic_dna',
    validate: (id) => ENSEMBL_GENE_PATTERN.test(id),
  },

  // ── Ensembl Transcript ──────────────────────────────────────────────────────
  {
    name:               'ENSEMBL_TRANSCRIPT',
    pattern:            ENSEMBL_TRANSCRIPT_PATTERN,
    proxyRoute:         '/api/proxy/ensembl',
    defaultMoleculeType: 'mrna',
    validate: (id) => ENSEMBL_TRANSCRIPT_PATTERN.test(id),
  },

  // ── PDB ─────────────────────────────────────────────────────────────────────
  {
    name:               'PDB',
    pattern:            PDB_PATTERN,
    proxyRoute:         '/api/proxy/pdb',
    defaultMoleculeType: 'protein',
    validate: (id) => PDB_PATTERN.test(id),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// UniProt validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a UniProt accession against the official format specification.
 *
 * UniProt accessions do not have a numerical checksum (unlike EAN/ISBN), but
 * the character-class constraints in the official regex are strict enough to
 * reject most transcription errors:
 *
 *   Swiss-Prot format (6 chars):
 *     Position 1: O, P, or Q (legacy)
 *     Position 2: digit 0–9
 *     Positions 3–5: any alphanumeric
 *     Position 6: digit 0–9
 *
 *   TrEMBL / extended format (6–10 chars):
 *     Position 1: A–Z excluding O, P, Q (covered by [A-NR-Z])
 *     Position 2: digit 0–9
 *     Suffix block: [A-Z][A-Z0-9]{2}[0-9], repeated 1–2 times
 *
 * @see https://www.uniprot.org/help/accession_numbers
 */
function validateUniProtAccession(id: string): boolean {
  return UNIPROT_PATTERN.test(id.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * classifyAccession
 *
 * Identifies which registry a given accession ID belongs to by testing it
 * against the ordered REGISTRY_RULES table.
 *
 * @param raw  Raw user-provided accession string.
 * @returns    The matching RegistryRule.
 * @throws     RegistryError('UNKNOWN_REGISTRY') if no rule matches.
 * @throws     RegistryError('INVALID_FORMAT') if a rule pattern matches but
 *             the deeper validate() check fails.
 */
function classifyAccession(raw: string): RegistryRule {
  const id = raw.trim().toUpperCase();

  if (!id) {
    throw new RegistryError(
      'Accession ID must not be empty.',
      'EMPTY_ID',
      raw,
    );
  }

  for (const rule of REGISTRY_RULES) {
    if (rule.pattern.test(id)) {
      if (rule.validate && !rule.validate(id)) {
        throw new RegistryError(
          `"${id}" matches the ${rule.name} pattern but fails structural validation. ` +
            'Verify the accession number and try again.',
          'INVALID_FORMAT',
          id,
        );
      }
      return rule;
    }
  }

  throw new RegistryError(
    `"${id}" does not match any known registry format ` +
      '(NCBI RefSeq / GenBank, UniProt, Ensembl, PDB). ' +
      'Check the accession number or consult the registry directly.',
    'UNKNOWN_REGISTRY',
    id,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Proxy fetch helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Standard query-parameter name for each proxy route. */
const PROXY_ID_PARAM: Record<string, string> = {
  '/api/proxy/ncbi':    'id',
  '/api/proxy/uniprot': 'id',
  '/api/proxy/ensembl': 'id',
  '/api/proxy/pdb':     'id',
};

/**
 * Builds the full proxy URL for a given accession and route.
 * The accession is always URL-encoded to handle dots, underscores, etc.
 */
function buildProxyUrl(proxyRoute: string, accession: string): string {
  const param = PROXY_ID_PARAM[proxyRoute] ?? 'id';
  return `${proxyRoute}?${param}=${encodeURIComponent(accession)}`;
}

/**
 * extractMetadataFromHeaders
 *
 * Reads well-known response headers set by the Sovereign Bridge proxy routes
 * and populates the metadata fields that are known only after the fetch.
 *
 * Expected headers (set by each proxy route):
 *   X-Accession-Organism      e.g. "Homo sapiens"
 *   X-Accession-Display-Name  e.g. "BRCA2"  or  "Breast cancer type 2 protein"
 *   X-Accession-Length        e.g. "3418"  (bp or aa as appropriate)
 */
function extractMetadataFromHeaders(
  headers: Headers,
  meta: AccessionMetadata,
): void {
  const organism    = headers.get('X-Accession-Organism');
  const displayName = headers.get('X-Accession-Display-Name');
  const length      = headers.get('X-Accession-Length');
  const molType     = headers.get('X-Accession-Molecule-Type') as MoleculeType | null;

  if (organism)    meta.organism       = organism;
  if (displayName) meta.displayName    = displayName;
  if (length)      meta.sequenceLength = parseInt(length, 10) || null;
  if (molType)     meta.moleculeType   = molType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * resolveAccession
 *
 * The unified entry-point for all Sovereign Bridge dispatches.
 *
 * PIPELINE:
 *   1. Normalise the raw string (trim, uppercase).
 *   2. Classify the ID against the registry rules table; validate structure.
 *   3. Build the proxy URL for the matched registry.
 *   4. Fetch via the server-side proxy (no direct browser → registry requests).
 *   5. Map proxy HTTP status codes to typed RegistryError instances.
 *   6. Extract AccessionMetadata from response headers + body.
 *   7. Return the metadata object to the caller (uiSlice.fetchExternalSequence).
 *
 * The caller is responsible for:
 *   • Passing the raw FASTA/JSON body to the genome worker pipeline.
 *   • Merging the returned AccessionMetadata into Zustand store state.
 *
 * @param rawId       Raw user-provided accession string.
 * @param fetchImpl   Optional fetch override for testing (defaults to global fetch).
 * @returns           AccessionMetadata populated from the proxy response.
 * @throws            RegistryError for all classification, validation, and
 *                    network-level failures.
 */
export async function resolveAccession(
  rawId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ metadata: AccessionMetadata; body: string }> {
  // ── 1. Normalise ──────────────────────────────────────────────────────────
  const id = rawId.trim().toUpperCase();

  // ── 2. Classify + validate ────────────────────────────────────────────────
  const rule = classifyAccession(id); // throws RegistryError on failure

  // ── 3. Build proxy URL ────────────────────────────────────────────────────
  const proxyUrl = buildProxyUrl(rule.proxyRoute, id);

  // ── 4. Fetch ──────────────────────────────────────────────────────────────
  let res: Response;
  try {
    res = await fetchImpl(proxyUrl, {
      method: 'GET',
      headers: { Accept: 'text/plain, application/json' },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new RegistryError(
      isTimeout
        ? `Registry proxy at ${rule.proxyRoute} did not respond within 60 s for "${id}".`
        : `Network error reaching ${rule.proxyRoute}: ${err instanceof Error ? err.message : String(err)}`,
      'PROXY_HTTP_ERROR',
      id,
    );
  }

  // ── 5. Map HTTP status → typed error ─────────────────────────────────────
  if (res.status === 404) {
    throw new RegistryError(
      `"${id}" was not found in ${rule.name}. Verify the accession number.`,
      'PROXY_NOT_FOUND',
      id,
    );
  }
  if (res.status === 429) {
    throw new RegistryError(
      `${rule.name} rate limit exceeded while fetching "${id}". ` +
        `Please wait before retrying.`,
      'PROXY_RATE_LIMITED',
      id,
    );
  }
  if (res.status === 423) {
    throw new RegistryError(
      `The Sovereign Bridge circuit breaker is open for ${rule.name}. ` +
        `Retrying too soon — please wait.`,
      'PROXY_CIRCUIT_OPEN',
      id,
    );
  }
  if (res.status === 503) {
    throw new RegistryError(
      `${rule.name} is currently unavailable (HTTP 503). Try again shortly.`,
      'PROXY_SERVICE_BUSY',
      id,
    );
  }
  if (!res.ok) {
    throw new RegistryError(
      `${rule.name} proxy returned HTTP ${res.status} for "${id}".`,
      'PROXY_HTTP_ERROR',
      id,
    );
  }

  // ── 6. Read body ──────────────────────────────────────────────────────────
  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    throw new RegistryError(
      `Failed to read response body for "${id}" from ${rule.name}: ` +
        (err instanceof Error ? err.message : String(err)),
      'RESPONSE_PARSE_ERROR',
      id,
    );
  }

  if (!body || body.trim().length === 0) {
    throw new RegistryError(
      `${rule.name} returned an empty body for "${id}".`,
      'RESPONSE_PARSE_ERROR',
      id,
    );
  }

  // ── 7. Build metadata ─────────────────────────────────────────────────────
  const moleculeType =
    rule.name === 'NCBI_REFSEQ'
      ? inferNCBIMoleculeType(id)
      : rule.defaultMoleculeType;

  const metadata: AccessionMetadata = {
    accession:      id,
    registry:       rule.name,
    moleculeType,
    organism:       null,
    displayName:    null,
    sequenceLength: null,
    fetchedAt:      new Date().toISOString(),
    proxyRoute:     rule.proxyRoute,
  };

  // Populate fields from proxy-set response headers.
  extractMetadataFromHeaders(res.headers, metadata);

  // Fallback: attempt to parse organism / display name from FASTA header
  // ("> <header text>") if the proxy didn't set the custom headers.
  if ((!metadata.organism || !metadata.displayName) && body.trimStart().startsWith('>')) {
    parseFastaHeaderIntoMetadata(body, metadata);
  }

  return { metadata, body };
}

// ─────────────────────────────────────────────────────────────────────────────
// FASTA header parser (fallback metadata extraction)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * parseFastaHeaderIntoMetadata
 *
 * Extracts organism and display name from a raw FASTA header line when the
 * proxy didn't set the X-Accession-* response headers.
 *
 * Handles common NCBI FASTA header formats:
 *
 *   >NC_000913.3 Escherichia coli str. K-12 substr. MG1655, complete genome
 *   >NM_001301717.2 Homo sapiens BRCA2 (BRCA2), mRNA
 *   >sp|P12345|AATM_RABIT AMP deaminase; Oryctolagus cuniculus
 *
 * UniProt SwissProt format:
 *   >sp|P12345|AATM_RABIT AMP deaminase OS=Oryctolagus cuniculus OX=9986 GN=AMPD1 PE=1 SV=2
 */
function parseFastaHeaderIntoMetadata(
  rawBody: string,
  meta: AccessionMetadata,
): void {
  const firstLine = rawBody.split('\n')[0] ?? '';
  if (!firstLine.startsWith('>')) return;

  const header = firstLine.slice(1).trim();

  // UniProt sp|ID|ENTRY format: extract OS= field
  const osMatch = /OS=([^=]+?)(?:\s+OX=|\s+GN=|\s+PE=|$)/.exec(header);
  if (osMatch?.[1]) {
    meta.organism = osMatch[1].trim();
  }

  // UniProt GN= field
  const gnMatch = /GN=(\S+)/.exec(header);
  if (gnMatch?.[1] && !meta.displayName) {
    meta.displayName = gnMatch[1].trim();
  }

  // For plain NCBI headers, the display name is the part after the first
  // space (minus the accession).  Organism is typically after the last comma.
  if (!meta.organism && !osMatch) {
    const parts = header.split(',');
    if (parts.length > 1) {
      const lastPart = parts[parts.length - 1]?.trim();
      if (lastPart) {
        // Strip trailing annotations like ", complete genome"
        meta.organism = lastPart
          .replace(/\b(complete|partial)\s+(genome|sequence|cds)\b/gi, '')
          .trim() || null;
      }
    }
  }

  if (!meta.displayName) {
    const spaceIdx = header.indexOf(' ');
    if (spaceIdx !== -1) {
      meta.displayName = header.slice(spaceIdx + 1).split(',')[0]?.trim() ?? null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience re-exports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * classifyOnly
 *
 * Lightweight classification without a network fetch.
 * Useful for pre-validation in UI input fields (e.g. displaying a registry
 * badge as the user types) without triggering a fetch.
 *
 * Returns null if the ID is not recognised.
 */
export function classifyOnly(
  rawId: string,
): { registry: RegistryName; moleculeType: MoleculeType; proxyRoute: string } | null {
  try {
    const rule = classifyAccession(rawId);
    const id = rawId.trim().toUpperCase();
    const moleculeType =
      rule.name === 'NCBI_REFSEQ'
        ? inferNCBIMoleculeType(id)
        : rule.defaultMoleculeType;
    return { registry: rule.name, moleculeType, proxyRoute: rule.proxyRoute };
  } catch {
    return null;
  }
}