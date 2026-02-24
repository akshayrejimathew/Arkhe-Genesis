'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GitBranch, GitCommit, Clock } from 'lucide-react';
import { useArkheStore } from '@/store';
import type { ArkheState } from '@/store/types';
import type { Commit, Branch } from '@/types/arkhe';

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

interface GraphNode {
  commit: Commit;
  x: number;
  y: number;
  column: number;
  isHead: boolean;
  branchColor: string;
}

export default function ChronosGraph() {
  const commits = useArkheStore((state: ArkheState) => state.commits);
  const branches = useArkheStore((state: ArkheState) => state.branches);
  const headCommitId = useArkheStore((state: ArkheState) => state.chronosHead);
  const checkout = useArkheStore((state: ArkheState) => state.checkout);
  const undo = useArkheStore((state: ArkheState) => state.undo);
  const redo = useArkheStore((state: ArkheState) => state.redo);
  
  const [hoveredCommit, setHoveredCommit] = useState<string | null>(null);

  // Branch colors
  const branchColors: Record<string, string> = {
    main: '#06b6d4', // Cyan
    master: '#06b6d4',
    develop: '#10b981', // Emerald
    feature: '#8b5cf6', // Purple
    hotfix: '#f43f5e', // Rose
  };

  // Build graph layout
  const graphNodes = useMemo(() => {
    if (!commits || commits.length === 0) return [];

    const nodes: GraphNode[] = [];
    const nodeSpacingY = 60;
    const columnSpacingX = 40;
    const columnMap = new Map<string, number>();
    let nextColumn = 0;

    // Sort commits by timestamp (newest first)
    const sortedCommits = [...commits].sort((a, b) => b.timestamp - a.timestamp);

    sortedCommits.forEach((commit, index) => {
      // Assign column based on branch
      const branchName = commit.branchName || 'main';
      let column = columnMap.get(branchName);
      
      if (column === undefined) {
        column = nextColumn++;
        columnMap.set(branchName, column);
      }

      const color = branchColors[branchName] || branchColors.main;

      nodes.push({
        commit,
        x: column * columnSpacingX + 20,
        y: index * nodeSpacingY + 40,
        column,
        isHead: commit.txId === headCommitId,
        branchColor: color,
      });
    });

    return nodes;
  }, [commits, headCommitId]);

  // Build connection lines
  const connectionLines = useMemo(() => {
    const lines: Array<{ from: GraphNode; to: GraphNode }> = [];

    graphNodes.forEach(node => {
      node.commit.parentTxIds.forEach(parentId => {
        const parentNode = graphNodes.find(n => n.commit.txId === parentId);
        if (parentNode) {
          lines.push({ from: node, to: parentNode });
        }
      });
    });

    return lines;
  }, [graphNodes]);

  // Handle commit click
  const handleCommitClick = (commit: Commit) => {
    if (commit.branchName) {
      checkout(commit.branchName);
    }
  };

  // Show empty state
  if (!commits || commits.length === 0) {
    return (
      <div className={cn(
        "w-full h-full bg-[#0A0A0A]/50 backdrop-blur-sm border border-white/5 rounded-lg",
        "flex flex-col items-center justify-center p-8 text-center"
      )}>
        <GitBranch className="w-12 h-12 text-slate-700 mb-4" strokeWidth={1.5} />
        <div className="text-sm text-slate-500 uppercase tracking-wider mb-2">
          No Version History
        </div>
        <div className="text-xs text-slate-700 max-w-xs">
          Make mutations to create your first commit
        </div>
      </div>
    );
  }

  const svgHeight = Math.max(400, graphNodes.length * 60 + 80);
  const svgWidth = Math.max(300, (Math.max(...graphNodes.map(n => n.column)) + 1) * 40 + 40);

  return (
    <div className="w-full h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-500" />
          <span className="text-[10px] font-black tracking-[0.2em] text-slate-400 uppercase">
            Chronos Timeline
          </span>
        </div>
        
        {/* Undo/Redo buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => undo()}
            className={cn(
              "px-2 py-1 text-[9px] uppercase tracking-wider rounded transition-colors",
              "hover:bg-white/5 text-slate-500 hover:text-slate-300"
            )}
          >
            Undo
          </button>
          <button
            onClick={() => redo()}
            className={cn(
              "px-2 py-1 text-[9px] uppercase tracking-wider rounded transition-colors",
              "hover:bg-white/5 text-slate-500 hover:text-slate-300"
            )}
          >
            Redo
          </button>
        </div>
      </div>

      {/* Graph Container */}
      <div className="flex-1 overflow-auto p-4 bg-[#030303]/50">
        <svg
          width={svgWidth}
          height={svgHeight}
          className="overflow-visible"
        >
          {/* Connection lines */}
          <g className="connections">
            {connectionLines.map((line, index) => {
              const path = `M ${line.from.x} ${line.from.y} C ${line.from.x} ${
                (line.from.y + line.to.y) / 2
              }, ${line.to.x} ${(line.from.y + line.to.y) / 2}, ${line.to.x} ${line.to.y}`;

              return (
                <motion.path
                  key={`line-${index}`}
                  d={path}
                  stroke={line.from.branchColor}
                  strokeWidth={2}
                  strokeOpacity={0.3}
                  fill="none"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.3 }}
                  transition={{ duration: 0.5, delay: index * 0.05 }}
                />
              );
            })}
          </g>

          {/* Commit nodes */}
          <g className="nodes">
            {graphNodes.map((node, index) => (
              <g
                key={node.commit.txId}
                transform={`translate(${node.x}, ${node.y})`}
                onMouseEnter={() => setHoveredCommit(node.commit.txId)}
                onMouseLeave={() => setHoveredCommit(null)}
                onClick={() => handleCommitClick(node.commit)}
                className="cursor-pointer"
              >
                {/* Glow for head commit */}
                {node.isHead && (
                  <circle
                    r={16}
                    fill={node.branchColor}
                    opacity={0.2}
                    className="animate-pulse"
                  />
                )}

                {/* Outer ring */}
                <motion.circle
                  r={10}
                  fill="none"
                  stroke={node.branchColor}
                  strokeWidth={2}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                />

                {/* Inner fill */}
                <motion.circle
                  r={node.isHead ? 7 : 5}
                  fill={node.isHead ? node.branchColor : '#0A0A0A'}
                  stroke={node.branchColor}
                  strokeWidth={node.isHead ? 0 : 1}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                />

                {/* Checkpoint marker */}
                {node.commit.isCheckpoint && (
                  <GitCommit
                    x={-6}
                    y={-6}
                    width={12}
                    height={12}
                    className="text-rose-500"
                    strokeWidth={2}
                  />
                )}
              </g>
            ))}
          </g>
        </svg>

        {/* Commit labels */}
        <div className="relative" style={{ height: svgHeight }}>
          {graphNodes.map((node) => {
            const isHovered = hoveredCommit === node.commit.txId;
            
            return (
              <AnimatePresence key={node.commit.txId}>
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="absolute"
                  style={{
                    left: node.x + 20,
                    top: node.y - 10,
                  }}
                >
                  <div
                    className={cn(
                      "px-3 py-1.5 rounded-md backdrop-blur-md border transition-all",
                      "max-w-xs",
                      isHovered
                        ? "bg-[#0A0A0A]/90 border-white/20 shadow-lg"
                        : "bg-[#0A0A0A]/70 border-white/5"
                    )}
                  >
                    {/* Commit message */}
                    <div className="text-xs text-slate-300 font-medium mb-1">
                      {node.commit.commitMessage || 'Untitled commit'}
                    </div>

                    {/* Metadata */}
                    {isHovered && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="text-[10px] text-slate-500 space-y-1"
                      >
                        {node.commit.author && (
                          <div>By: {node.commit.author}</div>
                        )}
                        <div className="flex items-center gap-2">
                          <span>
                            {new Date(node.commit.timestamp).toLocaleString()}
                          </span>
                          {node.commit.branchName && (
                            <>
                              <span className="text-slate-700">•</span>
                              <span style={{ color: node.branchColor }}>
                                {node.commit.branchName}
                              </span>
                            </>
                          )}
                        </div>
                        <div>Mutations: {node.commit.mutations.length}</div>
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            );
          })}
        </div>
      </div>

      {/* Branch legend */}
      <div className="border-t border-white/5 px-4 py-2">
        <div className="flex items-center gap-4 flex-wrap">
          {branches.map((branch) => {
            const color = branchColors[branch.name] || branchColors.main;
            const isActive = headCommitId === branch.headCommitId;
            
            return (
              <button
                key={branch.name}
                onClick={() => checkout(branch.name)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1 rounded text-[10px] uppercase tracking-wider transition-all",
                  isActive
                    ? "bg-white/10 text-slate-200"
                    : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                )}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {branch.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}