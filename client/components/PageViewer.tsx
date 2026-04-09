import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MDEditor from '@uiw/react-md-editor';
import { Save, Trash2, Edit3, Book } from 'lucide-react';
import { WikiPage } from '../types';

interface PageViewerProps {
  currentPage: WikiPage | null;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  editContent: string;
  setEditContent: (content: string) => void;
  handleSave: () => void;
  handleDelete: () => void;
  loadPage: (id: string) => void;
}

export default function PageViewer({
  currentPage,
  isEditing,
  setIsEditing,
  editContent,
  setEditContent,
  handleSave,
  handleDelete,
  loadPage
}: PageViewerProps) {
  if (!currentPage) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-4">
        <Book className="w-12 h-12 opacity-20" />
        <p>Select a page to start reading</p>
      </div>
    );
  }

  return (
    <div className="p-12 max-w-4xl mx-auto w-full h-full">
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between">
          <h2 className="text-4xl font-bold tracking-tight capitalize">
            {currentPage.id.replace(/-/g, ' ')}
          </h2>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button 
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSave}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all"
                >
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
              </>
            ) : (
              <>
                {currentPage.id !== 'index' && currentPage.id !== 'log' && (
                  <button 
                    onClick={handleDelete}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600/10 hover:bg-red-600/20 text-red-500 rounded-lg text-sm font-medium transition-all"
                    title="Delete Page"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                )}
                <button 
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-all"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit Page
                </button>
              </>
            )}
          </div>
        </div>

        {/* Cluster badges */}
        {currentPage.clusters && currentPage.clusters.length > 0 && (
          <div className="cluster-badges">
            {currentPage.clusters.map(cl => (
              <span
                key={cl.id}
                className="cluster-badge"
                style={{
                  background: `${cl.color}18`,
                  color: cl.color,
                  border: `1px solid ${cl.color}30`,
                }}
              >
                <span className="cluster-badge-dot" style={{ background: cl.color }} />
                {cl.label}
              </span>
            ))}
          </div>
        )}
        <div className="prose prose-invert prose-indigo max-w-none">
          {isEditing ? (
            <div data-color-mode="dark" className="w-full">
              <MDEditor
                value={editContent}
                onChange={(val) => setEditContent(val || '')}
                height={500}
                className="border border-zinc-800 rounded-xl overflow-hidden !bg-zinc-900"
              />
            </div>
          ) : (
            <div className="markdown-body">
              <Markdown 
                remarkPlugins={[remarkGfm]}
                components={{
                  a(props) {
                    const { node, href, children, ...rest } = props;
                    return (
                      <a 
                        href={href} 
                        onClick={(e) => {
                          e.preventDefault();
                          if (href && !href.startsWith('http')) {
                            let pageId = href;
                            if (pageId.startsWith('/')) pageId = pageId.substring(1);
                            if (pageId.endsWith('.md')) pageId = pageId.slice(0, -3);
                            loadPage(pageId);
                          } else if (href) {
                            window.open(href, '_blank', 'noopener,noreferrer');
                          }
                        }}
                        className="text-indigo-400 hover:text-indigo-300 no-underline hover:underline cursor-pointer transition-colors"
                        {...rest}
                      >
                        {children}
                      </a>
                    );
                  }
                }}
              >
                {currentPage.content}
              </Markdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
