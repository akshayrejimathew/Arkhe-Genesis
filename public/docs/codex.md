# 🏛️ Arkhé Genesis — Sovereign Research Handbook

> *A clinical-grade genomic IDE. Zero telemetry. Total data sovereignty.*

---

## 1. Philosophical Foundation

Arkhé Genesis is not a standard web application — it is a **Sovereign Genomic IDE**.

Unlike tools that process data on a central server, Arkhé processes everything locally in your browser using **Virtual Memory Slabs**. This ensures that your research never leaves your machine until you explicitly choose to export it.

Your genome is yours. The IDE enforces this at the architecture level, not as a policy.

---

## 2. System Architecture — The Triad

Arkhé is built on three interlocking engines that run entirely in-browser:

### 🧠 The Slab Engine
Data is stored in **1 MB increments inside a `SharedArrayBuffer`**. This allows sub-millisecond manipulation of gigabyte-scale sequences. The SlabManager streams your FASTA or GenBank file from disk into memory slabs without ever sending a byte to a server.

### 🛡️ The Sentinel
A background **Biosecurity thread** that continuously audits your work against a curated library of known threat signatures using the **Aho-Corasick multi-pattern algorithm**. Every sequence load and every mutation is screened automatically. You cannot bypass this scan — it runs unconditionally on the raw slabs, not the visible viewport.

### 🌿 Chronos DAG
A **Directed Acyclic Graph** that records every mutation as a SHA-256-chained commit. You can time-travel to any previous state of your sequence without data loss. Branches, merges, and reversions are all supported via the `history`, `branch`, `merge`, and `revert` commands.

---

## 3. The Command Codex — ArkhéScript

All IDE operations are available as terminal commands. Type any command in the **BioTerminal** at the bottom of the workbench.

### 🔬 Sequence Operations

| Command | Usage | Result |
|---|---|---|
| `fetch` | `fetch [AccessionID]` | Imports high-fidelity sequence data from NCBI RefSeq, UniProtKB, or Ensembl via the Sovereign Bridge. Supports all standard accession formats. |
| `load` | `load [path]` | Loads a local FASTA, GenBank, or AB1 file into the SlabManager worker pipeline. |
| `export` | `export [fhir\|pdf\|fasta]` | Generates a cryptographically signed clinical report or raw sequence file. |
| `reverse` | `reverse` | Reverse-complements the loaded sequence in-place and commits the change to Chronos. |
| `slice` | `slice [start] [end]` | Extracts a subsequence by 1-based coordinates into a new buffer. |

### 🛡️ Scanning & Analysis

| Command | Usage | Result |
|---|---|---|
| `scan` | `scan` | Force-triggers a **deep-sector biosecurity audit** across all SlabManager memory slabs. Results appear in the Sentinel panel. |
| `fold` | `fold [ID]` | Submits the sequence to the **Meta ESM Atlas** for 3D protein structure prediction. Renders in the Protein Viewport tab. |
| `pcr` | `pcr` | Opens the **PCR simulation suite** to test primer binding efficiency and predicted product length. |
| `orf` | `orf [min-len]` | Finds all open reading frames longer than `min-len` codons (default: 30). Results populate the ORF panel. |
| `gc` | `gc [window]` | Computes GC content globally or as a rolling window in base pairs. |
| `align` | `align [ID1] [ID2]` | Runs a pairwise alignment against a second accession or the current sequence. |

### 🌿 Chronos — Version Control

| Command | Usage | Result |
|---|---|---|
| `history` | `history` | Opens the **Chronos lineage view** — the full mutation DAG with SHA-256 commit hashes and timestamps. |
| `commit` | `commit "[message]"` | Commits the current sequence state with a human-readable message. |
| `revert` | `revert [hash]` | Reverts to any prior commit by its SHA-256 prefix. Non-destructive. |
| `branch` | `branch [name]` | Creates a new named branch from the current HEAD commit. |
| `merge` | `merge [branch]` | Merges a named branch into HEAD. Conflicts are surfaced in the Diff View tab. |

### ⚙️ System & Session

| Command | Usage | Result |
|---|---|---|
| `status` | `status` | Prints engine status: loaded sequence length, worker health, Sovereign Mode flag. |
| `clear` | `clear` | Clears the terminal output ring-buffer (1,000-line hard cap enforced). |
| `help` | `help` | Opens this **Command Codex** modal directly in the IDE. |
| `reset` | `reset` | Hard-resets the engine worker and flushes all SlabManager memory. Use with caution. |
| `find` | `find [pattern]` | Searches the loaded sequence for a nucleotide or amino-acid pattern. Supports IUPAC ambiguity codes. |
| `report` | `report [format]` | Generates a full analysis report in HTML, PDF, or JSON. |

---

## 4. Active Feature Inventory

| Feature | Status | Description |
|---|---|---|
| **Sovereign Bridges** | ✅ Live | Direct, secure proxies to NCBI, UniProt, and Ensembl. No data is cached server-side. |
| **Real-time Biosecurity** | ✅ Live | Automatic detection of Dual-Use Research of Concern (DURC) sequences via Aho-Corasick. |
| **Protein Visualisation** | ✅ Live | PDB-standard 3D rendering for ESM-folded structures in the Protein Viewport. |
| **Surgical Mutation Tool** | ✅ Live | Scalpel-grade precision for SNPs, indels, codon optimisation, and restriction site engineering. |
| **FHIR Compatibility** | ✅ Live | Cryptographically signed reports ready for clinical laboratory workflow integration. |
| **Chronos DAG** | ✅ Live | SHA-256-chained, immutable mutation history with branching and merge support. |
| **PCR Simulation** | ✅ Live | In-silico primer design and amplicon prediction against the full loaded sequence. |
| **Off-Target Heatmap** | 🔬 Beta | Visual heatmap of potential CRISPR off-target binding sites across the genome. |

---

## 5. Keyboard Reference

| Shortcut | Action |
|---|---|
| `↑ / ↓` in terminal | Browse command history |
| `Esc` in terminal | Clear the input field |
| `Esc` in any modal | Close modal |
| `← / →` in tour | Navigate onboarding steps |
| `Ctrl + /` | Focus BioTerminal |
| `Ctrl + S` | Commit current state to Chronos |

---

## 6. Glossary

**SlabManager** — The in-browser virtual memory manager that stores genomic data in 1 MB `SharedArrayBuffer` chunks, enabling gigabyte-scale operations without server round-trips.

**Sovereign Bridge** — The Arkhé proxy layer that connects to external registries (NCBI, UniProt, Ensembl) without caching your queries or sequences on Arkhé infrastructure.

**DURC** — Dual-Use Research of Concern. Sequences that could potentially be misused for harmful purposes. Sentinel screens all loaded sequences against the current DURC signature library.

**Chronos** — The mutation version-control system. Every edit creates a new DAG node. The commit graph is stored locally and optionally synced to Supabase in Sovereign Mode.

**ArkhéScript** — The terminal command language for Arkhé Genesis. All IDE operations have a corresponding ArkhéScript command.

---

*Arkhé Genesis · Sovereign Edition · Build v1.0*
*Zero telemetry · All processing in-browser · Your data never leaves your machine.*