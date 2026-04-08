import React from 'react';
import ForceGraph2D from 'react-force-graph-2d';

interface GraphViewerProps {
  graphData: { nodes: any[]; links: any[] };
  currentPageId: string | undefined;
  loadPage: (id: string) => void;
  setViewMode: (mode: 'read' | 'graph') => void;
}

export default function GraphViewer({
  graphData,
  currentPageId,
  loadPage,
  setViewMode
}: GraphViewerProps) {
  return (
    <div className="w-full h-full relative" style={{ cursor: 'crosshair' }}>
      <ForceGraph2D
        graphData={graphData}
        nodeLabel="name"
        nodeColor={(node: any) => currentPageId === node.id ? '#10b981' : '#6366f1'}
        nodeRelSize={6}
        linkColor={() => '#3f3f46'}
        linkWidth={1.5}
        onNodeClick={(node: any) => {
          loadPage(node.id);
          setViewMode('read');
        }}
        backgroundColor="#09090b" // Match zinc-950
      />
    </div>
  );
}
