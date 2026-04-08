import React, { useState } from 'react';
import { X, Globe, Upload, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface IngestModalProps {
  isIngesting: boolean;
  setIsIngesting: (isIngesting: boolean) => void;
  ingestUrl: string;
  setIngestUrl: (url: string) => void;
  handleIngestUrl: () => void;
  handleFileUpload: (files: FileList) => void;
  isLoading: boolean;
}

export default function IngestModal({
  isIngesting,
  setIsIngesting,
  ingestUrl,
  setIngestUrl,
  handleIngestUrl,
  handleFileUpload,
  isLoading
}: IngestModalProps) {
  const [isDragging, setIsDragging] = useState(false);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  return (
    <AnimatePresence>
      {isIngesting && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-xl font-bold">Ingest New Source</h3>
              <button onClick={() => setIsIngesting(false)} className="p-2 hover:bg-zinc-800 rounded-lg transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Website URL</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input 
                    type="text"
                    placeholder="https://example.com/article"
                    value={ingestUrl}
                    onChange={(e) => setIngestUrl(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:border-indigo-500/50 transition-all"
                  />
                </div>
              </div>

              <div 
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className="relative group cursor-pointer"
              >
                <div className={`absolute inset-0 bg-indigo-600/5 border-2 border-dashed rounded-2xl transition-all ${isDragging ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' : 'border-zinc-800 group-hover:border-indigo-500/50'}`}></div>
                <div className="relative p-12 flex flex-col items-center justify-center text-center space-y-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isDragging ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{isDragging ? 'Drop to upload' : 'Drop files here or click to upload'}</p>
                    <p className="text-xs text-zinc-500 mt-1">Markdown, Text, or Images</p>
                  </div>
                  <input 
                    type="file" 
                    multiple 
                    className="absolute inset-0 opacity-0 cursor-pointer" 
                    onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                  />
                </div>
              </div>

              <button 
                onClick={handleIngestUrl}
                disabled={!ingestUrl || isLoading}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Process Source
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
