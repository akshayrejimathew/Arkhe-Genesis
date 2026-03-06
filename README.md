# 🌑 ARKHÉ GENESIS: SOVEREIGN GENOMIC IDE
**Status:** RUO (Research Use Only) | Pinnacle Alpha v1.0
**Architecture:** Distributed Slab-Memory Engine (Browser-Native)

---

## 🏛️ ARCHITECTURAL MANIFESTO
Arkhé Genesis is not a website; it is a **Sovereign Instrument** for synthetic biology. It is designed to handle gigabyte-scale genomic data with zero-latency by offloading all heavy computation to a multi-threaded **Slab Memory Engine**.

### 🧬 THE THREE PILLARS
1. **Sovereignty:** Local-first data processing. Sequences never leave the browser slab unless explicitly committed to the encrypted Vault.
2. **Precision:** Scientific calculations (Molecular Weight, Monoisotopic Mass) use 128-bit BigInt precision to eliminate IEEE-754 floating-point drift.
3. **Security:** Real-time biosecurity screening using Aho-Corasick bitmasking to detect pathogen signatures across slab boundaries.

---

## 📂 CORE DIRECTORY MAP (FOR AI AGENTS)
*AI Note: Do not hallucinate standard REST patterns. This app uses a Message-Passing architecture.*

### 🧠 THE ENGINE (WEB WORKER)
- `src/app/worker/ArkheEngine.worker.ts`: The central nervous system. Handles message-passing between UI and scientific logic.
- `src/lib/SlabManager.ts`: Manages the 1MB memory slabs and SharedArrayBuffer synchronization.
- `src/lib/BioLogic.ts`: The physics engine. Handles mass spectrometry math and GOR IV secondary structure prediction.
- `src/lib/ScreeningEngine.ts`: The Sentinel. High-performance Aho-Corasick biosecurity scanner.

### 🖥️ THE INTERFACE (UI & STATE)
- `src/store/uiSlice.ts`: The canonical Zustand store. Manages terminal logs, worker status, and session-specific states.
- `src/components/Terminal.tsx`: Virtualized log stream using `react-virtuoso`. Handles "Abyssal" theme GPU rendering.
- `src/lib/Vault.ts`: Cryptographic handler for sequence encryption-at-rest.

---

## 🛠️ TECHNICAL SPECIFICATIONS
- **Frontend:** Next.js 15 (App Router), React, Tailwind CSS.
- **State:** Zustand (Immutability-enforced).
- **Animations:** Framer Motion (Glassmorphism & Abyssal effects).
- **Virtualization:** React-Virtuoso (Terminal & Sequence viewers).
- **Database:** Supabase (Auth & Shared Genome Registry).
- **Compliance:** Cross-Origin Isolation (COOP/COEP) enabled for `SharedArrayBuffer` support.

---

## 🚀 DEVELOPMENT DIRECTIVES
1. **No Float for Science:** All mass/precision math must be scaled and handled via `BigInt`.
2. **Worker-First:** All sequence mutations must be dispatched to the worker. Do not block the Main Thread.
3. **Virtualize Everything:** Any list exceeding 50 items must use virtualization to maintain 120fps.
4. **Sovereignty First:** Ensure all `IndexedDB` data is purged upon session logout.

---

## 🏛️ THE PINNACLE STANDARD
*"Precision is the only defense against entropy."*
This IDE is built for researchers who require absolute integrity. Every line of code must reflect this rigor.