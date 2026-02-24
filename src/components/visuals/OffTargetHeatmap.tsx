'use client';

import { motion } from 'framer-motion';
import { AlertTriangle, MapPin } from 'lucide-react';
import { useState } from 'react';
import { useArkheStore } from '@/store';
import type { ThreatMatch } from '@/lib/sentinel/ScreeningEngine';

interface OffTargetHeatmapProps {
  sequence: string;
  viewport: { start: number; end: number };
  onNavigate?: (position: number) => void;
}

/**
 * OFF-TARGET HEATMAP – now uses real threat matches from Sentinel.
 */
export default function OffTargetHeatmap({ 
  sequence, 
  viewport,
  onNavigate 
}: OffTargetHeatmapProps) {
  const [hoveredSite, setHoveredSite] = useState<ThreatMatch | null>(null);
  const threatMatches = useArkheStore((state) => state.threatMatches);

  // Filter sites visible in current viewport
  const visibleSites = threatMatches.filter(
    site => site.position >= viewport.start && site.position <= viewport.end
  );

  // Render sequence with heatmap overlay
  const renderSequenceWithHeatmap = () => {
    const chunkSize = 60;
    const chunks = [];
    const visibleSeq = sequence.substring(viewport.start, viewport.end);

    for (let i = 0; i < visibleSeq.length; i += chunkSize) {
      chunks.push({
        text: visibleSeq.substring(i, i + chunkSize),
        startIndex: viewport.start + i,
      });
    }

    return chunks.map((chunk, chunkIdx) => (
      <div key={chunkIdx} className="flex gap-4 mb-1 group">
        {/* Line number */}
        <span className="text-zinc-700 select-none text-xs w-20 text-right flex-shrink-0 font-mono">
          {chunk.startIndex.toLocaleString()}
        </span>

        {/* Sequence with heatmap */}
        <div className="flex-1 font-mono text-sm tracking-wider relative">
          {chunk.text.split('').map((base, baseIdx) => {
            const globalPos = chunk.startIndex + baseIdx;
            
            // Find if this position is in a threat match
            const threat = threatMatches.find(
              site => globalPos >= site.position && globalPos < site.position + 12
            );

            if (threat) {
              const intensity = 0.8; // fixed intensity for threat matches
              const isHovered = hoveredSite?.position === threat.position;

              return (
                <motion.span
                  key={baseIdx}
                  className="relative inline-block cursor-pointer"
                  onMouseEnter={() => setHoveredSite(threat)}
                  onMouseLeave={() => setHoveredSite(null)}
                  onClick={() => onNavigate?.(threat.position)}
                  animate={{
                    textShadow: [
                      `0 0 ${5 + intensity * 15}px rgba(244, 63, 94, ${intensity * 0.6})`,
                      `0 0 ${10 + intensity * 20}px rgba(244, 63, 94, ${intensity * 0.9})`,
                      `0 0 ${5 + intensity * 15}px rgba(244, 63, 94, ${intensity * 0.6})`,
                    ],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  style={{
                    color: `rgb(244, ${63 - intensity * 20}, ${94 - intensity * 40})`,
                    fontWeight: isHovered ? 'bold' : 'normal',
                  }}
                >
                  {base}
                  
                  {/* Background glow */}
                  <motion.span
                    className="absolute inset-0 -z-10 rounded"
                    animate={{
                      backgroundColor: [
                        `rgba(244, 63, 94, ${intensity * 0.1})`,
                        `rgba(244, 63, 94, ${intensity * 0.3})`,
                        `rgba(244, 63, 94, ${intensity * 0.1})`,
                      ],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                    }}
                  />
                </motion.span>
              );
            }

            // Normal base
            return (
              <span key={baseIdx} className="text-zinc-400">
                {base}
              </span>
            );
          })}
        </div>
      </div>
    ));
  };

  return (
    <div className="w-full h-full flex flex-col bg-void border border-razor rounded-lg overflow-hidden backdrop-blur-md">
      {/* Header */}
      <div className="h-12 border-b border-razor bg-void-surface/80 backdrop-blur-md flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 drop-shadow-glow-rose" />
          <h2 className="text-sm font-black uppercase tracking-wider text-white">
            Threat Heatmap
          </h2>
          <div className="px-2 py-0.5 bg-rose-500/20 border border-rose-500/30 rounded text-[9px] font-mono text-rose-400">
            {threatMatches.length} threat{threatMatches.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="text-[10px] font-mono text-zinc-600">
          Viewing {viewport.start.toLocaleString()} - {viewport.end.toLocaleString()}
        </div>
      </div>

      {/* Heatmap Sequence */}
      <div className="flex-1 overflow-auto p-4 bg-gradient-to-b from-void/95 to-void-black/95">
        {visibleSites.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center">
            <div>
              <MapPin className="w-12 h-12 text-zinc-700 mx-auto mb-3 opacity-50" />
              <p className="text-sm text-zinc-600">No threats in current view</p>
              <p className="text-xs text-zinc-700 mt-1">Scroll to scan</p>
            </div>
          </div>
        ) : (
          renderSequenceWithHeatmap()
        )}
      </div>

      {/* Hovered Threat Details */}
      {hoveredSite && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-t border-razor bg-void-surface/80 backdrop-blur-md p-4"
        >
          <div className="flex items-start gap-3">
            <div className="p-2 bg-rose-500/20 rounded">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                  Pathogen Detected
                </span>
                <span className="text-[10px] font-mono text-zinc-600">
                  Position: {hoveredSite.position.toLocaleString()}
                </span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Name:</span>
                  <span className="font-mono text-rose-300">{hoveredSite.pathogen}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Sequence:</span>
                  <span className="font-mono text-rose-300">{hoveredSite.sequence}</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Legend */}
      <div className="h-10 border-t border-razor bg-void-surface/80 backdrop-blur-md flex items-center justify-center gap-8 text-[9px] font-mono flex-shrink-0">
        <div className="flex items-center gap-2">
          <motion.div 
            className="w-3 h-3 rounded-full bg-rose-600"
            animate={{
              boxShadow: [
                '0 0 5px rgba(244, 63, 94, 0.6)',
                '0 0 15px rgba(244, 63, 94, 0.9)',
                '0 0 5px rgba(244, 63, 94, 0.6)',
              ],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
            }}
          />
          <span className="text-rose-400">Pathogen Signature</span>
        </div>
      </div>
    </div>
  );
}