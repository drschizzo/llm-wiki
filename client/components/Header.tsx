import React, { useState } from 'react';
import { Search, Eraser, Globe, HelpCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import HelpModal from './HelpModal';

interface HeaderProps {
  searchQuery: string;
  handleSearch: (q: string) => void;
  searchResults: any[];
  loadPage: (id: string) => void;
  setSearchResults: (results: any[]) => void;
  setSearchQuery: (query: string) => void;
  handleCleanup: () => void;
  isLoading: boolean;
  viewMode: 'read' | 'graph';
  setViewMode: (mode: 'read' | 'graph') => void;
}

export default function Header({
  searchQuery,
  handleSearch,
  searchResults,
  loadPage,
  setSearchResults,
  setSearchQuery,
  handleCleanup,
  isLoading,
  viewMode,
  setViewMode
}: HeaderProps) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  return (
    <>
      <header className="h-16 border-b border-zinc-800 flex items-center px-8 gap-6 bg-zinc-950/50 backdrop-blur-md z-10">
        <div className="flex-1 relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-indigo-400 transition-colors" />
          <input 
            type="text"
            placeholder="Search wiki..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
          />
          
          {/* Search Results Dropdown */}
          <AnimatePresence>
            {searchResults.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50"
              >
                {searchResults.map((res: any) => (
                  <button
                    key={res.id}
                    onClick={() => { loadPage(res.id); setSearchResults([]); setSearchQuery(''); }}
                    className="w-full text-left p-4 hover:bg-zinc-800 border-b border-zinc-800 last:border-0 transition-colors"
                  >
                    <div className="font-medium text-indigo-400 capitalize mb-1">{res.id.replace(/-/g, ' ')}</div>
                    <div className="text-xs text-zinc-500 line-clamp-1">{res.snippet}</div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={handleCleanup}
            disabled={isLoading}
            className={`p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-all ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Clean Dead Links"
          >
            <Eraser className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setViewMode(viewMode === 'graph' ? 'read' : 'graph')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'graph' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            title="Toggle Graph View"
          >
            <Globe className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsHelpOpen(true)}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-all border border-transparent hover:border-zinc-700"
            title="Aide"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </header>

      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </>
  );
}
