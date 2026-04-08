import React from 'react';
import { Book, FileText, Plus } from 'lucide-react';
import { LLMProvider } from '../types';

interface SidebarProps {
  pages: string[];
  currentPageId: string | undefined;
  loadPage: (id: string) => void;
  llmProvider: LLMProvider;
  setLlmProvider: (provider: LLMProvider) => void;
  setIsIngesting: (isIngesting: boolean) => void;
}

export default function Sidebar({
  pages,
  currentPageId,
  loadPage,
  llmProvider,
  setLlmProvider,
  setIsIngesting
}: SidebarProps) {
  return (
    <aside className="w-64 border-r border-zinc-800 flex flex-col bg-zinc-900/50 backdrop-blur-xl">
      <div className="p-6 flex items-center gap-3 border-b border-zinc-800">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Book className="w-5 h-5 text-white" />
        </div>
        <h1 className="font-bold text-lg tracking-tight">LLM Wiki</h1>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-2">Pages</div>
        {pages.map(page => (
          <button
            key={page}
            onClick={() => loadPage(page)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all ${
              currentPageId === page 
                ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20' 
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span className="truncate capitalize">{page.replace(/-/g, ' ')}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-zinc-800 space-y-2">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-xs font-medium text-zinc-500">Provider</span>
          <div className="flex bg-zinc-800 rounded-full p-0.5">
            <button 
              onClick={() => setLlmProvider('gemini')}
              className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold transition-all ${llmProvider === 'gemini' ? 'bg-indigo-600 text-white' : 'text-zinc-500'}`}
            >
              Gemini
            </button>
            <button 
              onClick={() => setLlmProvider('lmstudio')}
              className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold transition-all ${llmProvider === 'lmstudio' ? 'bg-indigo-600 text-white' : 'text-zinc-500'}`}
            >
              Local
            </button>
          </div>
        </div>
        <button 
          onClick={() => setIsIngesting(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-indigo-500/20"
        >
          <Plus className="w-4 h-4" />
          Ingest Source
        </button>
      </div>
    </aside>
  );
}
