'use client';

import { motion } from 'framer-motion';
import { GitCompare, ArrowRight } from 'lucide-react';

interface Mutation {
  position: number;
  oldBase: string;
  newBase: string;
  type: 'substitution' | 'insertion' | 'deletion';
}

interface BioDiffModeProps {
  oldSequence: string;
  newSequence: string;
  mutations: Mutation[];
  highlightRange?: { start: number; end: number };
}

/**
 * BIO-DIFF MODE - Split-Screen Genome Comparison
 * Features: Dimmed old sequence, glowing violet mutations
 */
export default function BioDiffMode({ 
  oldSequence, 
  newSequence, 
  mutations,
  highlightRange 
}: BioDiffModeProps) {
  const chunkSize = 60; // Characters per line
  const contextWindow = 100; // Show context around mutations

  // Get mutation positions for highlighting
  const mutationPositions = new Set(mutations.map(m => m.position));

  // Split sequence into chunks
  const chunkSequence = (seq: string, start = 0, end = seq.length) => {
    const chunks = [];
    const relevantSeq = seq.substring(start, end);
    for (let i = 0; i < relevantSeq.length; i += chunkSize) {
      chunks.push({
        text: relevantSeq.substring(i, i + chunkSize),
        startIndex: start + i,
      });
    }
    return chunks;
  };

  // Determine visible range
  const getVisibleRange = () => {
    if (highlightRange) return highlightRange;
    if (mutations.length === 0) return { start: 0, end: Math.min(500, newSequence.length) };
    
    const firstMutation = mutations[0].position;
    const lastMutation = mutations[mutations.length - 1].position;
    return {
      start: Math.max(0, firstMutation - contextWindow),
      end: Math.min(newSequence.length, lastMutation + contextWindow),
    };
  };

  const visibleRange = getVisibleRange();
  const oldChunks = chunkSequence(oldSequence, visibleRange.start, visibleRange.end);
  const newChunks = chunkSequence(newSequence, visibleRange.start, visibleRange.end);

  return (
    <div className="w-full h-full bg-void border border-razor rounded-lg overflow-hidden backdrop-blur-md">
      {/* Header */}
      <div className="h-12 border-b border-razor bg-void-surface/80 backdrop-blur-md flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <GitCompare className="w-5 h-5 text-violet-400 drop-shadow-glow-violet" />
          <h2 className="text-sm font-black uppercase tracking-wider text-white">
            Bio-Diff Mode
          </h2>
          <div className="px-2 py-0.5 bg-violet-500/20 border border-violet-500/30 rounded text-[9px] font-mono text-violet-400">
            {mutations.length} mutation{mutations.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="text-[10px] font-mono text-zinc-600">
          Position {visibleRange.start.toLocaleString()} - {visibleRange.end.toLocaleString()}
        </div>
      </div>

      {/* Split View */}
      <div className="grid grid-cols-2 divide-x divide-razor h-[calc(100%-3rem)]">
        {/* Left: Old Sequence (Dimmed) */}
        <div className="overflow-auto p-4 bg-gradient-to-b from-void/95 to-void-black/95">
          <div className="text-[10px] uppercase tracking-wider text-zinc-700 mb-3 font-mono">
            Original Sequence
          </div>
          <div className="font-mono text-sm leading-relaxed">
            {oldChunks.map((chunk, chunkIdx) => (
              <div key={chunkIdx} className="flex gap-4 mb-1 group">
                {/* Line number */}
                <span className="text-zinc-700 select-none text-xs w-16 text-right flex-shrink-0">
                  {chunk.startIndex}
                </span>
                
                {/* Sequence */}
                <div className="flex-1 tracking-wider">
                  {chunk.text.split('').map((base, baseIdx) => {
                    const globalPos = chunk.startIndex + baseIdx;
                    const isMutation = mutationPositions.has(globalPos);
                    
                    return (
                      <span
                        key={baseIdx}
                        className={`
                          transition-all
                          ${isMutation 
                            ? 'text-zinc-600 opacity-30' 
                            : 'text-zinc-500 opacity-50'
                          }
                        `}
                      >
                        {base}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: New Sequence (High Contrast) */}
        <div className="overflow-auto p-4 bg-gradient-to-b from-void/95 to-void-black/95">
          <div className="text-[10px] uppercase tracking-wider text-violet-400 mb-3 font-mono flex items-center gap-2">
            <span>Modified Sequence</span>
            <ArrowRight className="w-3 h-3" />
          </div>
          <div className="font-mono text-sm leading-relaxed">
            {newChunks.map((chunk, chunkIdx) => (
              <div key={chunkIdx} className="flex gap-4 mb-1 group">
                {/* Line number */}
                <span className="text-zinc-700 select-none text-xs w-16 text-right flex-shrink-0">
                  {chunk.startIndex}
                </span>
                
                {/* Sequence */}
                <div className="flex-1 tracking-wider">
                  {chunk.text.split('').map((base, baseIdx) => {
                    const globalPos = chunk.startIndex + baseIdx;
                    const mutation = mutations.find(m => m.position === globalPos);
                    const isMutation = !!mutation;
                    
                    if (isMutation) {
                      return (
                        <motion.span
                          key={baseIdx}
                          initial={{ scale: 1.5, opacity: 0 }}
                          animate={{ 
                            scale: 1, 
                            opacity: [0.8, 1, 0.8],
                          }}
                          transition={{
                            duration: 0.5,
                            opacity: {
                              duration: 2,
                              repeat: Infinity,
                            }
                          }}
                          className="relative inline-block"
                        >
                          <span
                            className="font-bold text-violet-400"
                            style={{
                              textShadow: `
                                0 0 10px rgba(139, 92, 246, 0.8),
                                0 0 20px rgba(139, 92, 246, 0.4),
                                0 0 30px rgba(139, 92, 246, 0.2)
                              `,
                            }}
                          >
                            {base}
                          </span>
                          
                          {/* Glow background */}
                          <motion.span
                            className="absolute inset-0 bg-violet-500/20 rounded"
                            animate={{
                              opacity: [0.2, 0.4, 0.2],
                            }}
                            transition={{
                              duration: 1.5,
                              repeat: Infinity,
                            }}
                          />
                        </motion.span>
                      );
                    }
                    
                    return (
                      <span
                        key={baseIdx}
                        className="text-zinc-300"
                      >
                        {base}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mutation Legend */}
      <div className="h-8 border-t border-razor bg-void-surface/80 backdrop-blur-md flex items-center justify-center gap-6 text-[9px] font-mono">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-violet-400 shadow-glow-violet" />
          <span className="text-violet-400">New Mutations</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-zinc-600" />
          <span className="text-zinc-600">Original Bases</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-zinc-400" />
          <span className="text-zinc-400">Unchanged</span>
        </div>
      </div>
    </div>
  );
}

// Add to globals.css for violet glow
// .drop-shadow-glow-violet {
//   filter: drop-shadow(0 0 8px rgba(139, 92, 246, 0.8));
// }
// .shadow-glow-violet {
//   box-shadow: 0 0 20px rgba(139, 92, 246, 0.6), 0 0 40px rgba(139, 92, 246, 0.3);
// }