'use client';

import { motion } from 'framer-motion';
import { AlertTriangle, MapPin } from 'lucide-react';
import { useState } from 'react';

interface OffTargetSite {
  position: number;
  score: number; // 0-100, higher = more dangerous
  sequence: string;
  chromosome?: string;
}

interface OffTargetHeatmapProps {
  sequence: string;
  offTargetSites: OffTargetSite[];
  viewport: { start: number; end: number };
  onNavigate?: (position: number) => void;
}

/**
 * OFF-TARGET HEATMAP - Warning Amber Pulse Visualization
 * Features: Glowing amber pulse on dangerous regions, clickable navigation
 */
export default function OffTargetHeatmap({ 
  sequence, 
  offTargetSites, 
  viewport,
  onNavigate 
}: OffTargetHeatmapProps) {
  const [hoveredSite, setHoveredSite] = useState<OffTargetSite | null>(null);

  // Filter sites visible in current viewport
  const visibleSites = offTargetSites.filter(
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
            
            // Find if this position is in an off-target site
            const offTargetSite = offTargetSites.find(
              site => globalPos >= site.position && globalPos < site.position + site.sequence.length
            );

            if (offTargetSite) {
              const intensity = offTargetSite.score / 100;
              const isHovered = hoveredSite?.position === offTargetSite.position;

              return (
                <motion.span
                  key={baseIdx}
                  className="relative inline-block cursor-pointer"
                  onMouseEnter={() => setHoveredSite(offTargetSite)}
                  onMouseLeave={() => setHoveredSite(null)}
                  onClick={() => onNavigate?.(offTargetSite.position)}
                  animate={{
                    textShadow: [
                      `0 0 ${5 + intensity * 15}px rgba(245, 158, 11, ${intensity * 0.6})`,
                      `0 0 ${10 + intensity * 20}px rgba(245, 158, 11, ${intensity * 0.9})`,
                      `0 0 ${5 + intensity * 15}px rgba(245, 158, 11, ${intensity * 0.6})`,
                    ],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  style={{
                    color: `rgb(${245 - intensity * 60}, ${158 + intensity * 40}, ${11 + intensity * 30})`,
                    fontWeight: isHovered ? 'bold' : 'normal',
                  }}
                >
                  {base}
                  
                  {/* Background glow */}
                  <motion.span
                    className="absolute inset-0 -z-10 rounded"
                    animate={{
                      backgroundColor: [
                        `rgba(245, 158, 11, ${intensity * 0.1})`,
                        `rgba(245, 158, 11, ${intensity * 0.3})`,
                        `rgba(245, 158, 11, ${intensity * 0.1})`,
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
          <AlertTriangle className="w-5 h-5 text-amber-400 drop-shadow-glow-amber" />
          <h2 className="text-sm font-black uppercase tracking-wider text-white">
            Off-Target Heatmap
          </h2>
          <div className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/30 rounded text-[9px] font-mono text-amber-400">
            {offTargetSites.length} site{offTargetSites.length !== 1 ? 's' : ''}
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
              <p className="text-sm text-zinc-600">No off-target sites in current view</p>
              <p className="text-xs text-zinc-700 mt-1">Scroll or navigate to danger zones</p>
            </div>
          </div>
        ) : (
          renderSequenceWithHeatmap()
        )}
      </div>

      {/* Hovered Site Details */}
      {hoveredSite && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-t border-razor bg-void-surface/80 backdrop-blur-md p-4"
        >
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-500/20 rounded">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                  Off-Target Site
                </span>
                <span className="text-[10px] font-mono text-zinc-600">
                  Position: {hoveredSite.position.toLocaleString()}
                </span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Danger Score:</span>
                  <span className="font-mono text-amber-400">{hoveredSite.score}/100</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Sequence:</span>
                  <span className="font-mono text-amber-300">{hoveredSite.sequence}</span>
                </div>
                {hoveredSite.chromosome && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Location:</span>
                    <span className="font-mono text-zinc-400">{hoveredSite.chromosome}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Legend */}
      <div className="h-10 border-t border-razor bg-void-surface/80 backdrop-blur-md flex items-center justify-center gap-8 text-[9px] font-mono flex-shrink-0">
        <div className="flex items-center gap-2">
          <motion.div 
            className="w-3 h-3 rounded-full bg-amber-600"
            animate={{
              boxShadow: [
                '0 0 5px rgba(245, 158, 11, 0.6)',
                '0 0 15px rgba(245, 158, 11, 0.9)',
                '0 0 5px rgba(245, 158, 11, 0.6)',
              ],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
            }}
          />
          <span className="text-amber-400">High Risk (75-100)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500/60" />
          <span className="text-amber-500">Medium Risk (50-74)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-400/30" />
          <span className="text-amber-600">Low Risk (0-49)</span>
        </div>
      </div>
    </div>
  );
}