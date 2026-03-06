/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SPRINT C — Clinical Interoperability
 *
 * Maps Arkhé's internal genomic state to an HL7 FHIR R4 MolecularSequence
 * Resource and provides a browser-side download trigger.
 *
 * Spec reference: https://www.hl7.org/fhir/molecularsequence.html
 *
 * Design decisions:
 *   - coordinateSystem: 0  (0-based, UCSC/BED convention).  FHIR allows 0 or
 *     1; we pin to 0 because our internal slab offsets are also 0-based, which
 *     means external consumers can use the offsets directly without adjustment.
 *   - patient / specimen are OPTIONAL references, omitted entirely when no
 *     clinical context is bound (SPRINT 2 FIX). Placeholder strings are no
 *     longer emitted. Populate with real FHIR references before clinical use.
 *   - The vendor extension is now a standard FHIR R4 `extension` array with
 *     the StructureDefinition URL https://arkhe.bio/fhir/StructureDefinition/
 *     arkhe-extension (SPRINT 2 FIX). This passes FHIR validators.
 */

import { useArkheStore } from '@/store';
import { SourceTracker, type SequenceSource } from '@/lib/ExternalData';

// ─────────────────────────────────────────────────────────────────────────────
// § FHIR primitive helpers
// ─────────────────────────────────────────────────────────────────────────────

interface FHIRCoding {
  system: string;
  code:   string;
  display?: string;
}

interface FHIRCodeableConcept {
  coding: FHIRCoding[];
  text?: string;
}

interface FHIRReference {
  reference: string;
  display?:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// § FHIR R4 MolecularSequence resource (production subset)
// ─────────────────────────────────────────────────────────────────────────────

export interface FHIRMolecularSequence {
  resourceType:     'MolecularSequence';
  id:               string;
  meta: {
    profile:     string[];
    lastUpdated: string;
  };
  /** Human-readable narrative required by FHIR §2.1. */
  text: {
    status: 'generated';
    div:    string;
  };
  identifier: Array<{
    system: string;
    value:  string;
  }>;
  /**
   * Molecule type.  Always 'dna' unless a future pipeline surfaces RNA
   * transcripts or amino-acid sequences directly.
   */
  type: 'dna' | 'rna' | 'aa';
  /**
   * 0 = 0-based (UCSC).  Arkhé slab offsets are 0-based; we preserve that
   * convention throughout the export so consumers need no offset adjustment.
   */
  coordinateSystem: 0;
  /**
   * Patient reference — OPTIONAL.
   * Omitted from the export when no clinical context is bound.
   * MUST be populated before submission to a clinical FHIR server.
   */
  patient?: FHIRReference;
  /**
   * Specimen reference — OPTIONAL.
   * Omitted from the export when no LIMS integration is active.
   * MUST be populated before submission to a clinical FHIR server.
   */
  specimen?: FHIRReference;
  /** Device reference — the Arkhé sequencing engine. */
  device:   FHIRReference;
  referenceSeq?: {
    referenceSeqId?: FHIRCodeableConcept;
    genomeBuild?:    string;
    orientation?:    'sense' | 'antisense';
    strand?:         'watson' | 'crick';
    windowStart:     number;
    windowEnd:       number;
  };
  /** The actual observed nucleotide sequence string. */
  observedSeq: string;
  /** Optional quality metrics when available. */
  quality?: Array<{
    type:  'snp' | 'indel' | 'unknown';
    score: { value: number; system: string; code: string };
  }>;
  readCoverage?: number;
  repository?: Array<{
    type:       'login' | 'oauth' | 'open' | 'other';
    url?:       string;
    name?:      string;
    datasetId?: string;
  }>;
  /**
   * Arkhé vendor extension block — FHIR R4 compliant.
   *
   * SPRINT 2 FIX (TASK 3):
   *   The previous `_arkheExtension` key used a non-standard underscore prefix
   *   and a plain top-level object — both invalid in FHIR JSON. Replaced with
   *   the standard FHIR `extension` array structure where each element carries
   *   a URL-based identifier, making this resource pass FHIR validators.
   *
   *   Structure: each entry is a complex extension anchored to the canonical
   *   StructureDefinition URL, with child sub-extensions for each data field.
   */
  extension: Array<{
    url: string;
    extension: Array<{
      url:             string;
      valueString?:    string;
      valueBoolean?:   boolean;
      valueInteger?:   number;
      valueDecimal?:   number;
      valueDateTime?:  string;
    }>;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Generates a FHIR-compliant UUID-style resource id. */
function generateResourceId(): string {
  // crypto.randomUUID() is available in all modern browsers and Node ≥ 15.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Computes the GC percentage of a nucleotide string.
 * Returns undefined when the sequence is empty.
 */
function computeGcPercent(seq: string): number | undefined {
  if (!seq.length) return undefined;
  const gc = (seq.match(/[GCgc]/g) ?? []).length;
  return Math.round((gc / seq.length) * 10_000) / 100; // two decimal places
}

/**
 * Derives the FHIR referenceSeq.referenceSeqId from a SequenceSource, when
 * the source carries a verified accession number (NCBI / UniProt).
 */
function buildReferenceSeqId(
  source: SequenceSource | null,
): FHIRCodeableConcept | undefined {
  if (!source) return undefined;

  if (source.type === 'ncbi') {
    return {
      coding: [{
        system:  'https://www.ncbi.nlm.nih.gov/nucleotide/',
        code:    source.id,
        display: `NCBI Nucleotide: ${source.id}`,
      }],
      text: source.id,
    };
  }

  if (source.type === 'uniprot') {
    return {
      coding: [{
        system:  'https://www.uniprot.org/uniprot/',
        code:    source.id,
        display: `UniProt: ${source.id}`,
      }],
      text: source.id,
    };
  }

  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Core builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a fully-formed FHIR R4 MolecularSequence resource from the current
 * Arkhé store state.
 *
 * @throws {Error} if no genome is loaded (genomeLength === 0).
 */
export function buildFHIRMolecularSequence(): FHIRMolecularSequence {
  const state = useArkheStore.getState();

  const genomeLength = state.genomeLength;
  const observedSeq  = state.viewport?.sequence ?? '';
  const activeId     = state.activeGenomeId    ?? 'unknown';

  if (genomeLength === 0) {
    throw new Error(
      '[ClinicalExport] Cannot build FHIR resource: no genome is loaded.',
    );
  }

  const source    = SourceTracker.get();
  const isMutated = source?.type === 'manual';
  const gcPct     = computeGcPercent(observedSeq);
  const now       = new Date().toISOString();
  const resourceId = generateResourceId();

  // ── Reference sequence linkage (NCBI / UniProt only) ─────────────────────
  const refSeqId = buildReferenceSeqId(source);

  // ── Assemble the resource ─────────────────────────────────────────────────
  const resource: FHIRMolecularSequence = {
    resourceType: 'MolecularSequence',
    id: resourceId,

    meta: {
      profile:     ['http://hl7.org/fhir/StructureDefinition/MolecularSequence'],
      lastUpdated: now,
    },

    text: {
      status: 'generated',
      div: [
        '<div xmlns="http://www.w3.org/1999/xhtml">',
        `  <p><b>MolecularSequence</b> — ${activeId}</p>`,
        `  <p>Length: ${genomeLength.toLocaleString()} bp`,
        gcPct !== undefined ? ` · GC: ${gcPct}%` : '',
        '</p>',
        `  <p>Exported by Arkhé Genesis on ${now}</p>`,
        '</div>',
      ].join(''),
    },

    identifier: [
      {
        system: 'https://arkhe.bio/genome-id',
        value:  activeId,
      },
      {
        system: 'https://arkhe.bio/export-id',
        value:  resourceId,
      },
    ],

    type:             'dna',
    coordinateSystem: 0,  // 0-based, matching internal slab offsets

    // ── Patient / specimen / device ─────────────────────────────────────
    //
    // SPRINT 2 FIX (TASK 3):
    //   The previous implementation always emitted 'Patient/placeholder' and
    //   'Specimen/placeholder' strings. FHIR validators and downstream clinical
    //   pipelines reject resources containing placeholder literals — they cannot
    //   be resolved and break reference-integrity checks.
    //
    //   New behaviour: patient and specimen are OMITTED entirely when no
    //   real clinical context has been bound. The device reference is always
    //   present because it always refers to the Arkhé engine itself.
    //
    // TODO: when a patient/specimen context is available (e.g. via a LIMS
    //   integration), populate these fields with real FHIR references.
    device: {
      reference: 'Device/arkhe-genesis-v1',
      display:   'Arkhé Genesis Genomic IDE v1.0',
    },

    // ── Reference sequence (only present for verified external sources) ───
    ...(refSeqId !== undefined && {
      referenceSeq: {
        referenceSeqId: refSeqId,
        genomeBuild:    source?.type === 'ncbi' ? 'GRCh38' : undefined,
        orientation:    'sense',
        strand:         'watson',
        windowStart:    state.viewport?.start ?? 0,
        windowEnd:      state.viewport?.end   ?? genomeLength,
      },
    }),

    observedSeq: observedSeq,

    // ── Repository back-link (NCBI only) ──────────────────────────────────
    ...(source?.type === 'ncbi' && {
      repository: [{
        type:      'open',
        url:       `https://www.ncbi.nlm.nih.gov/nuccore/${source.id}`,
        name:      'NCBI Nucleotide',
        datasetId: source.id,
      }],
    }),

    // ── Arkhé vendor extension — FHIR R4 compliant extension array ──────────
    //
    // SPRINT 2 FIX (TASK 3):
    //   Replaced the non-standard `_arkheExtension` top-level object with a
    //   proper FHIR R4 complex extension anchored to a valid StructureDefinition
    //   URL. Each data point is a typed sub-extension element.
    extension: [
      {
        url: 'https://arkhe.bio/fhir/StructureDefinition/arkhe-extension',
        extension: [
          {
            url: 'sourceType',
            valueString: source?.type ?? 'unknown',
          },
          ...(source?.id ? [{ url: 'sourceId', valueString: source.id }] : []),
          {
            url: 'isMutated',
            valueBoolean: isMutated,
          },
          {
            url: 'genomeLength',
            valueInteger: genomeLength,
          },
          ...(gcPct !== undefined
            ? [{ url: 'gcPercent', valueDecimal: gcPct }]
            : []),
          {
            url: 'exportedAt',
            valueDateTime: now,
          },
          {
            url: 'arkheVersion',
            valueString: '1.0.0-sprint-2',
          },
        ],
      },
    ],
  };

  return resource;
}

// ─────────────────────────────────────────────────────────────────────────────
// § Download trigger
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the FHIR MolecularSequence resource from the current store state and
 * triggers a browser download of the resulting JSON file.
 *
 * Filename convention:  `arkhe_fhir_<activeGenomeId>_<YYYYMMDD>.json`
 *
 * @throws {Error} propagated from buildFHIRMolecularSequence when no genome
 *   is loaded.
 */
export function downloadFHIR(): void {
  const resource = buildFHIRMolecularSequence();

  const json     = JSON.stringify(resource, null, 2);
  const blob     = new Blob([json], { type: 'application/fhir+json;charset=utf-8' });
  const url      = URL.createObjectURL(blob);

  const activeId = useArkheStore.getState().activeGenomeId ?? 'genome';
  const dateStr  = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `arkhe_fhir_${activeId}_${dateStr}.json`;

  const anchor       = document.createElement('a');
  anchor.href        = url;
  anchor.download    = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Release the object URL after a short delay to allow the download to start.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}