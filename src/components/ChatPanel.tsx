import React from 'react';
import { X, MessageSquare, Sparkles, Plus, Link as LinkIcon, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { LLMProvider, WikiPage } from '../types';

interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
}

interface ChatPanelProps {
  isChatOpen: boolean;
  setIsChatOpen: (isOpen: boolean) => void;
  chatMessages: ChatMessage[];
  setChatMessages: (messages: ChatMessage[]) => void;
  chatInput: string;
  setChatInput: React.Dispatch<React.SetStateAction<string>>;
  handleChat: () => void;
  isLoading: boolean;
  llmProvider: LLMProvider;
  currentPage: WikiPage | null;
  viewMode: 'read' | 'graph';
}

export default function ChatPanel({
  isChatOpen,
  setIsChatOpen,
  chatMessages,
  setChatMessages,
  chatInput,
  setChatInput,
  handleChat,
  isLoading,
  llmProvider,
  currentPage,
  viewMode
}: ChatPanelProps) {
  return (
    <>
      {/* Floating Chat Button */}
      <button 
        onClick={() => setIsChatOpen(!isChatOpen)}
        className={`absolute bottom-8 right-8 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all z-20 ${isChatOpen ? 'bg-zinc-800 text-white rotate-90' : 'bg-indigo-600 text-white hover:scale-110'}`}
      >
        {isChatOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>

      {/* Chat Panel */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div 
            initial={{ opacity: 0, x: 400 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 400 }}
            className="absolute top-0 right-0 bottom-0 w-96 bg-zinc-900 border-l border-zinc-800 shadow-2xl flex flex-col z-10"
          >
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold">Wiki Assistant</h3>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setChatMessages([])}
                  className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-all"
                  title="New Conversation"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <div className="text-[10px] font-bold uppercase px-2 py-1 bg-zinc-800 rounded text-zinc-500">
                  {llmProvider}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {chatMessages.length === 0 && (
                <div className="text-center text-zinc-500 mt-12">
                  <p className="text-sm">Ask me to analyze your wiki, suggest new pages, or summarize a source.</p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-zinc-800 text-zinc-200 rounded-tl-none'}`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-800 p-3 rounded-2xl rounded-tl-none flex gap-1">
                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-zinc-800">
              {currentPage && viewMode === 'read' && (
                <div className="mb-3 flex">
                  <button
                    onClick={() => setChatInput(prev => prev + (prev.length > 0 && !prev.endsWith(' ') ? ' ' : '') + `(Context: ${currentPage.id}) `)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20 rounded-md text-xs font-medium transition-all"
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                    Reference {currentPage.id.replace(/-/g, ' ')}
                  </button>
                </div>
              )}
              <div className="relative">
                <textarea 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleChat();
                    }
                  }}
                  placeholder="Ask anything... (Shift+Enter for new line)"
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-indigo-500/50 transition-all resize-none"
                />
                <button 
                  onClick={handleChat}
                  className="absolute right-2 bottom-2.5 p-2 text-indigo-400 hover:text-indigo-300 transition-all"
                >
                  <Zap className="w-4 h-4 fill-current" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
