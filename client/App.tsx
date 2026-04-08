import React, { useState, useEffect } from 'react';

// Components
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import GraphViewer from './components/GraphViewer';
import PageViewer from './components/PageViewer';
import ChatPanel from './components/ChatPanel';
import IngestModal from './components/IngestModal';

// Types
import { Page, LLMProvider, WikiPage } from './types';

// --- App Component ---
export default function App() {
  const [pages, setPages] = useState<Page[]>([]);
  const [currentPage, setCurrentPage] = useState<WikiPage | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [llmProvider, setLlmProvider] = useState<LLMProvider>('gemini');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestUrl, setIngestUrl] = useState('');
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'ai', content: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'read' | 'graph'>('read');
  const [graphData, setGraphData] = useState<{nodes: any[], links: any[]}>({ nodes: [], links: [] });

  const loadGraphData = async () => {
    try {
      const res = await fetch("/api/graph");
      const data = await res.json();
      setGraphData(data);
    } catch (err) {
      console.error("Failed to load graph", err);
    }
  };

  const handleCleanup = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/clean-links', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setChatMessages(prev => [...prev, { 
          role: 'ai', 
          content: `Graph verified! Cleaned ${data.removedLinks} dead links across ${data.modifiedFiles} files.` 
        }]);
        if (viewMode === 'graph') loadGraphData();
      } else {
        setChatMessages(prev => [...prev, { role: 'ai', content: `Cleanup error: ${data.error}` }]);
      }
      setIsChatOpen(true);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'ai', content: "Failed to connect to backend for cleanup." }]);
      setIsChatOpen(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'graph') {
      loadGraphData();
    }
  }, [viewMode]);

  const loadPage = async (id: string, pushToHistory = true) => {
    const res = await fetch(`/api/wiki/${id}`);
    if (res.ok) {
      const data = await res.json();
      setCurrentPage(data);
      setEditContent(data.content);
      setIsEditing(false);
      if (pushToHistory) {
        window.history.pushState({ pageId: id }, '', `?page=${id}`);
      }
    }
  };

  const fetchPages = async () => {
    const res = await fetch('/api/wiki');
    const data = await res.json();
    setPages(data);
  };

  // Fetch pages and handle browser history
  useEffect(() => {
    fetchPages();
    
    const params = new URLSearchParams(window.location.search);
    const initialPage = params.get('page') || 'index';
    
    window.history.replaceState({ pageId: initialPage }, '', `?page=${initialPage}`);
    loadPage(initialPage, false);

    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.pageId) {
        loadPage(event.state.pageId, false);
      } else {
        const currentParams = new URLSearchParams(window.location.search);
        loadPage(currentParams.get('page') || 'index', false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSave = async () => {
    if (!currentPage) return;
    const res = await fetch(`/api/wiki/${currentPage.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent })
    });
    if (res.ok) {
      setCurrentPage({ ...currentPage, content: editContent });
      setIsEditing(false);
      fetchPages();
    }
  };

  const handleDelete = async () => {
    if (!currentPage) return;
    if (currentPage.id === 'index' || currentPage.id === 'log') {
      alert("Cannot delete system pages.");
      return;
    }
    if (!confirm(`Are you sure you want to delete "${currentPage.id}"? This action cannot be undone.`)) return;
    
    setIsLoading(true);
    try {
      const res = await fetch(`/api/wiki/${currentPage.id}`, { method: 'DELETE' });
      if (res.ok) {
        setChatMessages(prev => [...prev, { role: 'ai', content: `*(System: Deleted page: ${currentPage.id})*` }]);
        await fetchPages();
        loadPage('index');
      } else {
        alert("Failed to delete page");
      }
    } catch (err) {
      alert("Error connecting to backend");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setSearchResults(data);
  };

  const handleIngestUrl = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/ingest/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ingestUrl, provider: llmProvider })
      });
      const data = await res.json();

      if (data.success) {
        setChatMessages(prev => [...prev, { role: 'ai', content: `Ingestion complete! Updated pages: ${data.updatedPages.join(', ')}.` }]);
        fetchPages();
      } else {
        setChatMessages(prev => [...prev, { role: 'ai', content: `Error: ${data.error} - ${data.details}` }]);
      }
      setIsChatOpen(true);
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: 'ai', content: "Failed to connect to backend." }]);
      setIsChatOpen(true);
    } finally {
      setIsLoading(false);
      setIsIngesting(false);
      setIngestUrl('');
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    const newHistory = [...chatMessages, { role: 'user', content: userMsg } as const];
    setChatMessages(newHistory);
    setChatInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: newHistory,
          provider: llmProvider
        })
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'ai', content: data.text }]);
      
      if (data.updatedPages && data.updatedPages.length > 0) {
        setChatMessages(prev => [...prev, { role: 'ai', content: `*(System: The wiki was updated in the background. Pages modified: ${data.updatedPages.join(', ')})*` }]);
        fetchPages();
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'ai', content: "Error connecting to backend." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (files: FileList) => {
    setIsLoading(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    formData.append('provider', llmProvider);

    try {
      const res = await fetch('/api/ingest/files', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (data.success) {
         setChatMessages(prev => [...prev, { role: 'ai', content: `Upload complete! Updated pages: ${data.updatedPages.join(', ')}.` }]);
         fetchPages();
      } else {
         setChatMessages(prev => [...prev, { role: 'ai', content: `Upload error: ${data.error}` }]);
      }
      setIsChatOpen(true);
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: 'ai', content: "Failed to connect to backend for file upload." }]);
      setIsChatOpen(true);
    } finally {
      setIsLoading(false);
      setIsIngesting(false);
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500/30">
      
      <Sidebar 
        pages={pages}
        currentPageId={currentPage?.id}
        loadPage={loadPage}
        llmProvider={llmProvider}
        setLlmProvider={setLlmProvider}
        setIsIngesting={setIsIngesting}
      />

      {/* --- Main Content --- */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        
        <Header 
          searchQuery={searchQuery}
          handleSearch={handleSearch}
          searchResults={searchResults}
          loadPage={loadPage}
          setSearchResults={setSearchResults}
          setSearchQuery={setSearchQuery}
          handleCleanup={handleCleanup}
          isLoading={isLoading}
          viewMode={viewMode}
          setViewMode={setViewMode}
        />

        {/* Page Content */}
        <div className={`flex-1 overflow-y-auto w-full ${viewMode === 'graph' ? 'overflow-hidden' : ''}`}>
          {viewMode === 'graph' ? (
            <GraphViewer 
              graphData={graphData}
              currentPageId={currentPage?.id}
              loadPage={loadPage}
              setViewMode={setViewMode}
            />
          ) : (
            <PageViewer 
              currentPage={currentPage}
              isEditing={isEditing}
              setIsEditing={setIsEditing}
              editContent={editContent}
              setEditContent={setEditContent}
              handleSave={handleSave}
              handleDelete={handleDelete}
              loadPage={loadPage}
            />
          )}
        </div>

        <ChatPanel 
          isChatOpen={isChatOpen}
          setIsChatOpen={setIsChatOpen}
          chatMessages={chatMessages}
          setChatMessages={setChatMessages}
          chatInput={chatInput}
          setChatInput={setChatInput}
          handleChat={handleChat}
          isLoading={isLoading}
          llmProvider={llmProvider}
          currentPage={currentPage}
          viewMode={viewMode}
        />

      </main>

      <IngestModal 
        isIngesting={isIngesting}
        setIsIngesting={setIsIngesting}
        ingestUrl={ingestUrl}
        setIngestUrl={setIngestUrl}
        handleIngestUrl={handleIngestUrl}
        handleFileUpload={handleFileUpload}
        isLoading={isLoading}
      />

    </div>
  );
}
