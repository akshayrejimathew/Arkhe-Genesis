'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  GitBranch, 
  Clock, 
  CircleDot, 
  Circle,
  RotateCcw,
  CloudDownload,
  Loader2,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '@/lib/supabase';
import { useArkheStore, type ArkheState } from '@/store';

const cn = (...inputs: unknown[]) => twMerge(clsx(inputs));

interface CloudGenome {
  id: string;
  name: string;
  total_length?: number | null;
  updated_at: string | null;
}

interface ChronosSidebarProps {
  isCollapsed?: boolean;
  onToggle?: () => void;
}

export default function ChronosSidebar({ isCollapsed = false, onToggle }: ChronosSidebarProps) {
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [cloudGenomes, setCloudGenomes] = useState<CloudGenome[]>([]);
  const [isLoadingGenomes, setIsLoadingGenomes] = useState(false);

  const commits = useArkheStore((state: ArkheState) => state.commits);
  const branches = useArkheStore((state: ArkheState) => state.branches);
  const currentBranch = useArkheStore((state: ArkheState) => state.currentBranch);
  const chronosHead = useArkheStore((state: ArkheState) => state.chronosHead);
  const workerConnected = useArkheStore((state: ArkheState) => state.workerConnected);
  const checkout = useArkheStore((state: ArkheState) => state.checkout);
  const undo = useArkheStore((state: ArkheState) => state.undo);
  const redo = useArkheStore((state: ArkheState) => state.redo);
  const loadGenomeFromCloud = useArkheStore((state: ArkheState) => state.loadGenomeFromCloud);
  const getCommits = useArkheStore((state: ArkheState) => state.getCommits);
  const getBranches = useArkheStore((state: ArkheState) => state.getBranches);

  useEffect(() => {
    const loadData = async () => {
      if (!workerConnected) return;
      try {
        await getCommits();
        await getBranches();
      } catch (error) {
        console.warn('ChronosSidebar: Failed to load data:', error);
      }
    };
    loadData();
  }, [getCommits, getBranches, workerConnected]);

  const loadCloudGenomes = async () => {
    setIsLoadingGenomes(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('genomes')
        .select('*')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setCloudGenomes(data || []);
    } catch (error) {
      console.error('Failed to load cloud genomes:', error);
    } finally {
      setIsLoadingGenomes(false);
    }
  };

  const handleRestoreGenome = async (genomeId: string) => {
    try {
      await loadGenomeFromCloud(genomeId);
      setShowRestoreModal(false);
    } catch (error) {
      console.error('Failed to restore genome:', error);
    }
  };

  return (
    <div className={cn(
      "w-full h-full flex flex-col bg-void-panel transition-all duration-300",
      isCollapsed && "w-0 overflow-hidden"
    )}>
      {!workerConnected && (
        <div className="p-4 text-center text-ghost text-xs">
          <Loader2 className="animate-spin mx-auto mb-2" size={16} />
          <p>Initializing worker...</p>
        </div>
      )}
      
      {workerConnected && !isCollapsed && (
        <>
          {/* Header */}
          <div className="h-14 border-b border-razor bg-void-panel flex items-center justify-between px-6 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" strokeWidth={2} />
              <h2 className="text-sm font-black tracking-tighter uppercase text-primary">
                Chronos
              </h2>
            </div>

            <button
              onClick={onToggle}
              className="p-2 rounded-lg text-tertiary hover:text-primary hover:bg-void-surface transition-all"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Commits Section */}
            <div className="p-6">
              <div className="text-[10px] font-black tracking-widest text-tertiary uppercase mb-4">
                Commits
              </div>
              
              {commits.length === 0 ? (
                <div className="text-center py-8">
                  <Circle className="w-8 h-8 text-ghost mx-auto mb-2" />
                  <p className="text-xs text-quaternary">No commits yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {commits.map((commit) => (
                    <div
                      key={commit.txId}
                      className="p-3 rounded-lg bg-void-surface border border-razor hover:border-medium transition-all cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <CircleDot className="w-3 h-3 text-quaternary" />
                          <span className="text-xs font-mono text-secondary">
                            {commit.txId.slice(0, 8)}
                          </span>
                        </div>
                        <div className="text-[10px] text-quaternary font-mono mb-2 tracking-tighter">
                          {new Date(commit.timestamp || Date.now()).toLocaleString()}
                        </div>
                      </div>
                      <p className="text-xs text-tertiary">{commit.commitMessage}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 border-t border-razor space-y-2">
            <button
              onClick={() => setShowRestoreModal(true)}
              className="w-full p-3 rounded-lg bg-void-surface border border-razor hover:border-medium text-xs font-black uppercase tracking-wider text-tertiary hover:text-primary transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} />
              <span>Restore Genome</span>
            </button>
          </div>
        </>
      )}

      {/* Restore Modal */}
      <AnimatePresence>
        {showRestoreModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-void-deepest/80 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-96 max-h-[80vh] bg-void-panel border border-razor rounded-xl overflow-hidden"
            >
              <div className="p-6">
                <h3 className="text-lg font-black tracking-tighter text-primary mb-4">
                  Restore from Cloud
                </h3>
                
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {cloudGenomes.length === 0 ? (
                    <div className="text-center py-8">
                      <CloudDownload className="w-8 h-8 text-ghost mx-auto mb-2" />
                      <p className="text-xs text-quaternary">No genomes found</p>
                    </div>
                  ) : (
                    cloudGenomes.map((genome) => (
                      <button
                        key={genome.id}
                        onClick={() => handleRestoreGenome(genome.id)}
                        className="w-full p-3 rounded-lg bg-void-surface border border-razor hover:border-medium text-left transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-secondary">{genome.name}</span>
                          <span>•</span>
                          <span>{new Date(genome.updated_at || Date.now()).toLocaleDateString()}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="p-4 border-t border-razor flex justify-end">
                <button
                  onClick={() => setShowRestoreModal(false)}
                  className="px-4 py-2 rounded-lg bg-void-surface border border-razor hover:border-medium text-xs font-black uppercase tracking-wider text-tertiary hover:text-primary transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
