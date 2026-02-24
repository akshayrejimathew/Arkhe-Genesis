'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  FileText, 
  GitBranch, 
  Database, 
  Settings, 
  ChevronLeft,
  ChevronRight,
  Search,
  Terminal,
  Loader2,
  X,
  Shield,
  File,
} from 'lucide-react';
import { useArkheStore, type ArkheState } from '@/store';
import ArkheLogo from '@/components/branding/ArkheLogo';
import FileIngestor from '@/components/ingestion/FileIngestor';
import SequenceView from '@/components/SequenceView';
import ChronosSidebar from '@/components/ChronosSidebar';
import SurgicalToolbar from '@/components/layout/SurgicalToolbar';
import BioTerminal from '@/components/visuals/BioTerminal';
import Sentinel from '@/components/panels/Sentinel';
import DatabasePanel from '@/components/panels/DatabasePanel';
import CommandPalette from '@/components/ui/CommandPalette';

export default function Workbench() {
  // UI State
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [activeLeftPanel, setActiveLeftPanel] = useState<string>('explorer');
  const [activeRightPanel, setActiveRightPanel] = useState<string | null>('chronos');
  const [activeTab, setActiveTab] = useState<string>('main');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Store State
  const genomeLength = useArkheStore((state: ArkheState) => state.genomeLength);
  const workerConnected = useArkheStore((state: ArkheState) => state.workerConnected);
  const terminalLogs = useArkheStore((state: ArkheState) => state.terminalLogs);
  const viewport = useArkheStore((state: ArkheState) => state.viewport);
  const activeGenomeId = useArkheStore((state: ArkheState) => state.activeGenomeId);

  const hasGenomeLoaded = genomeLength > 0;

  // Left sidebar items with ACTIVE PULSE styling
  const leftSidebarItems = [
    { id: 'explorer', icon: FileText, label: 'Explorer', shortcut: '⌘E' },
    { id: 'search', icon: Search, label: 'Search', shortcut: '⌘F' },
    { id: 'database', icon: Database, label: 'Database', shortcut: '⌘D' },
    { id: 'sentinel', icon: Shield, label: 'Sentinel', shortcut: '⌘S' },
  ];

  const rightSidebarPanels = [
    { id: 'chronos', icon: GitBranch, label: 'Chronos', shortcut: '⌘G' },
    { id: 'terminal', icon: Terminal, label: 'Terminal', shortcut: '⌘T' },
  ];

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key.toLowerCase()) {
          case 'k':
            e.preventDefault();
            setCommandPaletteOpen(true);
            break;
          case 'b':
            e.preventDefault();
            setLeftSidebarCollapsed(!leftSidebarCollapsed);
            break;
          case 'g':
            e.preventDefault();
            setActiveRightPanel(activeRightPanel === 'chronos' ? null : 'chronos');
            setRightSidebarCollapsed(false);
            break;
          case 't':
            e.preventDefault();
            setActiveRightPanel(activeRightPanel === 'terminal' ? null : 'terminal');
            setRightSidebarCollapsed(false);
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [leftSidebarCollapsed, activeRightPanel, rightSidebarCollapsed]);

  return (
    <div className="flex h-screen bg-void text-primary overflow-hidden">
      {/* Command Palette */}
      <CommandPalette 
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* LEFT SIDEBAR - Navigation */}
      <aside
        className={`
          flex flex-col bg-void-panel border-r border-razor
          transition-all duration-200 ease-out flex-shrink-0
          ${leftSidebarCollapsed ? 'w-12' : 'w-64'}
        `}
      >
        {/* Header with Logo */}
        <div className="h-12 flex items-center justify-between px-3 border-b border-razor flex-shrink-0">
          {!leftSidebarCollapsed ? (
            <div className="flex items-center gap-2.5">
              <ArkheLogo 
                size={24} 
                variant="icon" 
                glow 
                className="text-white" 
              />
              <div className="flex flex-col">
                <span className="text-xs font-medium text-white tracking-tight leading-none">
                  Arkhé Genesis
                </span>
                <span className="text-[9px] text-zinc-600 uppercase tracking-wider leading-none mt-0.5">
                  Genomic IDE
                </span>
              </div>
            </div>
          ) : (
            <ArkheLogo 
              size={18} 
              variant="icon" 
              className="text-zinc-400 mx-auto" 
            />
          )}
          
          {!leftSidebarCollapsed && (
            <button
              onClick={() => setLeftSidebarCollapsed(true)}
              className="p-1.5 hover:bg-white/5 rounded transition-colors"
              title="Collapse (⌘B)"
            >
              <ChevronLeft size={14} className="text-zinc-500" />
            </button>
          )}
        </div>

        {/* Sidebar Navigation with ACTIVE PULSE */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {leftSidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeLeftPanel === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => setActiveLeftPanel(item.id)}
                className={`
                  relative w-full flex items-center gap-3 px-3 py-2 text-sm
                  transition-colors mx-1.5 my-0.5
                  ${isActive 
                    ? 'bg-white/5 text-white' 
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02]'
                  }
                `}
                title={leftSidebarCollapsed ? `${item.label} (${item.shortcut})` : item.shortcut}
              >
                {/* ACTIVE PULSE - 1px white line */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-white" />
                )}
                
                <Icon size={16} className="flex-shrink-0" />
                {!leftSidebarCollapsed && (
                  <>
                    <span className="flex-1 text-left text-xs">{item.label}</span>
                    <span className="text-[10px] text-zinc-600">{item.shortcut}</span>
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {/* Expand button when collapsed */}
        {leftSidebarCollapsed && (
          <div className="h-12 flex items-center justify-center border-t border-razor">
            <button
              onClick={() => setLeftSidebarCollapsed(false)}
              className="p-2 hover:bg-white/5 rounded transition-colors"
              title="Expand (⌘B)"
            >
              <ChevronRight size={14} className="text-zinc-500" />
            </button>
          </div>
        )}

        {/* Sidebar Footer */}
        {!leftSidebarCollapsed && (
          <div className="h-12 flex items-center justify-center border-t border-razor flex-shrink-0">
            <button
              onClick={() => setCommandPaletteOpen(true)}
              className="p-2 hover:bg-white/5 rounded transition-colors"
              title="Settings (⌘K)"
            >
              <Settings size={16} className="text-zinc-500" />
            </button>
          </div>
        )}
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="h-10 flex items-center justify-between px-4 bg-void-panel border-b border-razor flex-shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('main')}
              className={`
                relative px-3 py-1 text-xs font-medium rounded-md transition-all
                ${activeTab === 'main'
                  ? 'text-white bg-white/5'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02]'
                }
              `}
            >
              <span className="tracking-tight">
                {hasGenomeLoaded ? `${activeGenomeId || 'Genome'}.fasta` : 'Workspace'}
              </span>
              {hasGenomeLoaded && (
                <span className="ml-2 inline-block w-1 h-1 rounded-full bg-success" />
              )}
            </button>
          </div>

          {/* Status Indicators */}
          <div className="flex items-center gap-3 text-[10px]">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${workerConnected ? 'bg-success' : 'bg-zinc-600'}`} />
              <span className="text-zinc-500 uppercase tracking-wider">
                {workerConnected ? 'Ready' : 'Loading'}
              </span>
            </div>

            {hasGenomeLoaded && (
              <>
                <span className="text-zinc-700">|</span>
                <span className="text-zinc-500">
                  {genomeLength.toLocaleString()} bp
                </span>
                <span className="text-zinc-700">|</span>
                <span className="text-zinc-500">
                  GC: {viewport.gcPercent?.toFixed(1) || '--'}%
                </span>
              </>
            )}
          </div>
        </div>

        {/* Surgical Toolbar */}
        {hasGenomeLoaded && <SurgicalToolbar />}

        {/* Main Editor Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Primary Editor */}
          <main className="flex-1 overflow-hidden bg-void relative">
            {!workerConnected ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-zinc-600 mx-auto mb-3" />
                  <p className="text-xs text-zinc-500 uppercase tracking-wider">
                    Initializing Engine...
                  </p>
                </div>
              </div>
            ) : !hasGenomeLoaded ? (
              <div className="w-full h-full flex items-center justify-center p-8">
                <FileIngestor />
              </div>
            ) : (
              <SequenceView />
            )}
          </main>

          {/* LEFT PANEL CONTENT (Explorer, Search, Database, Sentinel) */}
          <AnimatePresence mode="wait">
            {!leftSidebarCollapsed && activeLeftPanel && (
              <motion.div
                key={`left-panel-${activeLeftPanel}`}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 280, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="border-l border-razor bg-void-panel flex flex-col overflow-hidden"
              >
                {activeLeftPanel === 'explorer' && <ExplorerPanel />}
                {activeLeftPanel === 'search' && <SearchPanel />}
                {activeLeftPanel === 'database' && <DatabasePanel />}
                {activeLeftPanel === 'sentinel' && <Sentinel />}
              </motion.div>
            )}
          </AnimatePresence>

          {/* RIGHT SIDEBAR - Context Panels */}
          <AnimatePresence mode="wait">
            {!rightSidebarCollapsed && activeRightPanel && (
              <motion.aside
                key="right-sidebar"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 320, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="border-l border-razor bg-void-panel flex flex-col overflow-hidden flex-shrink-0"
              >
                <div className="h-10 flex items-center justify-between px-3 border-b border-razor flex-shrink-0">
                  <div className="flex items-center gap-2">
                    {rightSidebarPanels.map((panel) => {
                      const Icon = panel.icon;
                      const isActive = activeRightPanel === panel.id;
                      return (
                        <button
                          key={panel.id}
                          onClick={() => setActiveRightPanel(panel.id)}
                          className={`
                            p-1.5 rounded transition-colors
                            ${isActive 
                              ? 'bg-white/5 text-white' 
                              : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02]'
                            }
                          `}
                          title={`${panel.label} (${panel.shortcut})`}
                        >
                          <Icon size={14} />
                        </button>
                      );
                    })}
                  </div>
                  
                  <button
                    onClick={() => {
                      setRightSidebarCollapsed(true);
                      setActiveRightPanel(null);
                    }}
                    className="p-1.5 hover:bg-white/5 rounded transition-colors"
                    title="Close panel"
                  >
                    <X size={14} className="text-zinc-500" />
                  </button>
                </div>

                <div className="flex-1 overflow-hidden">
                  {activeRightPanel === 'chronos' && (
                    <ChronosSidebar 
                      isCollapsed={false}
                      onToggle={() => {
                        setRightSidebarCollapsed(true);
                        setActiveRightPanel(null);
                      }}
                    />
                  )}
                  {activeRightPanel === 'terminal' && <BioTerminal />}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Status Bar */}
        <div className="h-6 flex items-center justify-between px-4 bg-void-panel border-t border-razor text-[10px] text-zinc-500 flex-shrink-0">
          <div className="flex items-center gap-4">
            <span className="uppercase tracking-wider">Arkhé v1.0</span>
            {hasGenomeLoaded && (
              <>
                <span className="text-zinc-700">•</span>
                <span>Viewport: {viewport.start?.toLocaleString()} - {viewport.end?.toLocaleString()}</span>
              </>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                setActiveRightPanel('terminal');
                setRightSidebarCollapsed(false);
              }}
              className="hover:text-zinc-300 transition-colors flex items-center gap-1.5"
            >
              <Terminal size={10} />
              <span className="uppercase tracking-wider">
                Terminal {terminalLogs.length > 0 && `(${terminalLogs.length})`}
              </span>
            </button>
            <span className="text-zinc-700">•</span>
            <span className="uppercase tracking-wider">UTF-8</span>
            <span className="text-zinc-700">•</span>
            <span className="uppercase tracking-wider">FASTA</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// INLINE PANEL COMPONENTS (Explorer, Search)
// ============================================

function ExplorerPanel() {
  // Connect to real branches data
  const branches = useArkheStore((state: ArkheState) => state.branches);
  const activeGenomeId = useArkheStore((state: ArkheState) => state.activeGenomeId);

  return (
    <div className="h-full flex flex-col bg-void">
      <div className="px-4 py-3 border-b border-razor">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Explorer
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {branches.length === 0 ? (
          <div className="text-center text-zinc-600 py-8">
            <File size={14} className="text-zinc-600 mx-auto mb-2" />
            <p className="text-xs">No branches available</p>
          </div>
        ) : (
          branches.map((branch, idx) => (
            <button
              key={branch.name}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 transition-colors text-left ${
                branch.name === activeGenomeId ? 'bg-white/10 border-l-2 border-l-cyan-400' : ''
              }`}
            >
              <File size={14} className="text-zinc-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-300 truncate">{branch.name}</div>
                <div className="text-[10px] text-zinc-600">
                  {branch.name === activeGenomeId ? 'Open File' : `ID: ${branch.headCommitId.slice(0, 8)}`}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function SearchPanel() {
  return (
    <div className="h-full flex flex-col bg-void">
      <div className="px-4 py-3 border-b border-razor">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Search
        </h3>
      </div>

      <div className="p-4">
        <input
          type="text"
          placeholder="Search sequences..."
          className="w-full px-3 py-2 bg-void-panel border border-razor rounded-md text-sm text-primary placeholder:text-disabled focus:border-primary focus:ring-1 focus:ring-primary/10 transition-all"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-center py-8 text-zinc-600">
          <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
          <p className="text-[10px] uppercase tracking-wider">No results</p>
        </div>
      </div>
    </div>
  );
}