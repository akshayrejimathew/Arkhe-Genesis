'use client';

import { useState, useEffect } from 'react';
import { Database, Download, ExternalLink, TrendingUp, BarChart3 } from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/hooks/useArkheStore';
import type { PublicGenome } from '@/lib/supabasePublic';

/**
 * DATABASE PANEL - Public Genomes Repository
 * Professional data grid with real cloud data
 */
export default function DatabasePanel() {
  const [selectedGenome, setSelectedGenome] = useState<string | null>(null);

  // Connect to real store data
  const publicGenomes = useArkheStore((state: ArkheState) => state.publicGenomes);
  const loadPublicGenomes = useArkheStore((state: ArkheState) => state.loadPublicGenomes);
  const loadFile = useArkheStore((state: ArkheState) => state.loadFile);

  // Load public genomes on mount
  useEffect(() => {
    loadPublicGenomes();
  }, [loadPublicGenomes]);

  const formatLength = (bp: number): string => {
    if (bp >= 1000000) {
      return `${(bp / 1000000).toFixed(2)} Mb`;
    }
    return `${(bp / 1000).toFixed(1)} kb`;
  };

  const handleDownload = async (genome: PublicGenome) => {
    try {
      // Fetch the file from URL
      const response = await fetch(genome.file_url);
      if (!response.ok) {
        throw new Error(`Failed to fetch genome: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const file = new File([blob], genome.name, { type: 'text/plain' });
      
      // Load the file using the store function
      await loadFile(file, genome.name);
      setSelectedGenome(genome.id);
    } catch (error) {
      console.error('Failed to load genome:', error);
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
        <p className="text-[10px] text-zinc-600">
          Reference sequences from NCBI RefSeq
        </p>
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
                  grid grid-cols-12 gap-2 px-4 py-3 cursor-pointer
                  transition-colors
                  ${isSelected
                    ? 'bg-white/5 border-l-2 border-l-cyan-400'
                    : 'hover:bg-white/[0.02]'
                  }
                `}
              >
                {/* Organism */}
                <div className="col-span-4">
                  <div className="text-xs text-zinc-300 font-medium mb-0.5">
                    {genome.name}
                  </div>
                  <div className="text-[10px] text-zinc-600 font-mono">
                    {genome.author}
                  </div>
                </div>

                {/* Size */}
                <div className="col-span-2 flex items-center">
                  <div className="text-[11px] font-mono text-zinc-400">
                    {formatLength(genome.total_length)}
                  </div>
                </div>

                {/* GC Content - Calculate dynamically or show placeholder */}
                <div className="col-span-2 flex items-center">
                  <div className="text-[11px] font-mono text-zinc-400">
                    Analyze
                  </div>
                </div>

                {/* Genes - Calculate dynamically or show placeholder */}
                <div className="col-span-2 flex items-center">
                  <div className="text-[11px] font-mono text-zinc-400">
                    Load to see
                  </div>
                </div>

                {/* Actions */}
                <div className="col-span-2 flex items-center justify-end gap-1">
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
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(genome.file_url, '_blank');
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
            const genome = publicGenomes.find(g => g.id === selectedGenome);
            if (!genome) return null;

            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-zinc-300 mb-0.5">
                      {genome.name}
                    </div>
                    <div className="text-[10px] text-zinc-600">
                      {genome.id} • Updated {new Date(genome.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-void border border-razor rounded">
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">
                      Length
                    </div>
                    <div className="text-xs font-mono text-zinc-300">
                      {formatLength(genome.total_length)}
                    </div>
                  </div>

                  <div className="p-2 bg-void border border-razor rounded">
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">
                      Author
                    </div>
                    <div className="text-xs font-mono text-zinc-300">
                      {genome.author}
                    </div>
                  </div>

                  <div className="p-2 bg-void border border-razor rounded">
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">
                      Description
                    </div>
                    <div className="text-xs text-zinc-300">
                      {genome.description}
                    </div>
                  </div>
                </div>

                {/* Action Button */}
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