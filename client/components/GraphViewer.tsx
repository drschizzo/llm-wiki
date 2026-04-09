import React, { useState, useEffect, useCallback, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Link2, Unlink, Tag, Plus, X, Trash2, Edit3 } from 'lucide-react';
import { ClusterInfo } from '../types';

const CLUSTER_PALETTE = [
  "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#f97316", "#14b8a6", "#a855f7",
];

interface GraphViewerProps {
  graphData: { nodes: any[]; links: any[]; clusters?: ClusterInfo[] };
  currentPageId: string | undefined;
  loadPage: (id: string) => void;
  setViewMode: (mode: 'read' | 'graph') => void;
  onGraphChanged: () => void;
}

type InteractionMode = 'default' | 'linking' | 'unlinking' | 'selecting';

interface ContextMenu {
  x: number;
  y: number;
  type: 'link' | 'node';
  linkData?: { source: string; target: string };
  nodeData?: { id: string; name: string };
}

interface ClusterPanelState {
  open: boolean;
  editingCluster: ClusterInfo | null;
  label: string;
  color: string;
  selectedPages: Set<string>;
}

export default function GraphViewer({
  graphData,
  currentPageId,
  loadPage,
  setViewMode,
  onGraphChanged,
}: GraphViewerProps) {
  const [mode, setMode] = useState<InteractionMode>('default');
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [unlinkSource, setUnlinkSource] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [clusters, setClusters] = useState<ClusterInfo[]>([]);
  const [clusterPanel, setClusterPanel] = useState<ClusterPanelState>({
    open: false,
    editingCluster: null,
    label: '',
    color: CLUSTER_PALETTE[0],
    selectedPages: new Set(),
  });

  const graphRef = useRef<any>(null);

  // Sync clusters from graphData
  useEffect(() => {
    if (graphData.clusters) {
      setClusters(graphData.clusters);
    }
  }, [graphData.clusters]);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode('default');
        setLinkSource(null);
        setUnlinkSource(null);
        setContextMenu(null);
        setClusterPanel(p => ({ ...p, open: false }));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Build a lookup: nodeId -> cluster colors
  const nodeClusterMap = useCallback((): Record<string, ClusterInfo[]> => {
    const map: Record<string, ClusterInfo[]> = {};
    for (const cluster of clusters) {
      for (const pageId of cluster.pageIds) {
        if (!map[pageId]) map[pageId] = [];
        map[pageId].push(cluster);
      }
    }
    return map;
  }, [clusters]);

  const getNodeColor = useCallback((node: any): string => {
    if (mode === 'linking' && linkSource === node.id) return '#fbbf24'; // amber for selected source
    if (mode === 'unlinking' && unlinkSource === node.id) return '#ef4444'; // red for unlink source
    if (mode === 'selecting' && clusterPanel.selectedPages.has(node.id)) return '#fbbf24';
    if (currentPageId === node.id) return '#10b981'; // green for current

    const clMap = nodeClusterMap();
    if (clMap[node.id] && clMap[node.id].length > 0) {
      return clMap[node.id][0].color; // First cluster color
    }
    return '#6366f1'; // default indigo
  }, [mode, linkSource, unlinkSource, currentPageId, nodeClusterMap, clusterPanel.selectedPages]);

  // --- Node click handling ---
  const handleNodeClick = useCallback((node: any) => {
    if (mode === 'linking') {
      if (!linkSource) {
        setLinkSource(node.id);
      } else {
        if (node.id !== linkSource) {
          // Create link
          fetch('/api/graph/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: linkSource, target: node.id }),
          })
            .then(r => r.json())
            .then(() => {
              onGraphChanged();
            })
            .catch(console.error);
        }
        setMode('default');
        setLinkSource(null);
      }
    } else if (mode === 'unlinking') {
      if (!unlinkSource) {
        setUnlinkSource(node.id);
      } else {
        if (node.id !== unlinkSource) {
          // Delete link
          fetch('/api/graph/link', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: unlinkSource, target: node.id }),
          })
            .then(r => r.json())
            .then(() => {
              onGraphChanged();
            })
            .catch(console.error);
        }
        setMode('default');
        setUnlinkSource(null);
      }
    } else if (mode === 'selecting') {
      setClusterPanel(prev => {
        const newSet = new Set(prev.selectedPages);
        if (newSet.has(node.id)) {
          newSet.delete(node.id);
        } else {
          newSet.add(node.id);
        }
        return { ...prev, selectedPages: newSet };
      });
    } else {
      loadPage(node.id);
      setViewMode('read');
    }
  }, [mode, linkSource, unlinkSource, loadPage, setViewMode, onGraphChanged]);

  // --- Node right click ---
  const handleNodeRightClick = useCallback((node: any, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      type: 'node',
      nodeData: { id: node.id, name: node.name },
    });
  }, []);

  // --- Link right click ---
  const handleLinkRightClick = useCallback((link: any, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      type: 'link',
      linkData: { source: sourceId, target: targetId },
    });
  }, []);

  // --- Delete link ---
  const handleDeleteLink = useCallback(async (source: string, target: string) => {
    setContextMenu(null);
    try {
      await fetch('/api/graph/link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, target }),
      });
      onGraphChanged();
    } catch (err) {
      console.error('Failed to delete link', err);
    }
  }, [onGraphChanged]);

  // --- Add node to cluster ---
  const handleAddToCluster = useCallback(async (nodeId: string, cluster: ClusterInfo) => {
    setContextMenu(null);
    if (cluster.pageIds.includes(nodeId)) return;
    try {
      await fetch(`/api/clusters/${cluster.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds: [...cluster.pageIds, nodeId] }),
      });
      onGraphChanged();
    } catch (err) {
      console.error('Failed to add to cluster', err);
    }
  }, [onGraphChanged]);

  // --- Cluster CRUD ---
  const handleSaveCluster = useCallback(async () => {
    if (!clusterPanel.label.trim() || !clusterPanel.color) return;

    try {
      if (clusterPanel.editingCluster) {
        await fetch(`/api/clusters/${clusterPanel.editingCluster.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: clusterPanel.label,
            color: clusterPanel.color,
            pageIds: Array.from(clusterPanel.selectedPages),
          }),
        });
      } else {
        await fetch('/api/clusters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: clusterPanel.label,
            color: clusterPanel.color,
            pageIds: Array.from(clusterPanel.selectedPages),
          }),
        });
      }
      setClusterPanel({ open: false, editingCluster: null, label: '', color: CLUSTER_PALETTE[0], selectedPages: new Set() });
      setMode('default');
      onGraphChanged();
    } catch (err) {
      console.error('Failed to save cluster', err);
    }
  }, [clusterPanel, onGraphChanged]);

  const handleDeleteCluster = useCallback(async (clusterId: string) => {
    try {
      await fetch(`/api/clusters/${clusterId}`, { method: 'DELETE' });
      setClusterPanel({ open: false, editingCluster: null, label: '', color: CLUSTER_PALETTE[0], selectedPages: new Set() });
      setMode('default');
      onGraphChanged();
    } catch (err) {
      console.error('Failed to delete cluster', err);
    }
  }, [onGraphChanged]);

  const openEditCluster = useCallback((cluster: ClusterInfo) => {
    setClusterPanel({
      open: true,
      editingCluster: cluster,
      label: cluster.label,
      color: cluster.color,
      selectedPages: new Set(cluster.pageIds),
    });
    setMode('selecting');
  }, []);

  const openNewCluster = useCallback(() => {
    setClusterPanel({
      open: true,
      editingCluster: null,
      label: '',
      color: CLUSTER_PALETTE[0],
      selectedPages: new Set(),
    });
    setMode('selecting');
  }, []);

  // --- Custom node rendering with cluster rings ---
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const nodeSize = 6;
    const clMap = nodeClusterMap();
    const nodeClusters = clMap[node.id] || [];

    // Draw cluster rings
    if (nodeClusters.length > 0) {
      const ringWidth = 2.5 / globalScale;
      nodeClusters.forEach((cl, i) => {
        const radius = nodeSize + ringWidth * (i + 1) + 1 / globalScale;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = cl.color;
        ctx.lineWidth = ringWidth;
        ctx.stroke();
      });
    }

    // Draw main node
    ctx.beginPath();
    ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI);
    ctx.fillStyle = getNodeColor(node);
    ctx.fill();

    // Label
    const fontSize = Math.max(12 / globalScale, 3);
    ctx.font = `${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#d4d4d8';
    ctx.fillText(node.name || node.id, node.x, node.y + nodeSize + 3 / globalScale);
  }, [getNodeColor, nodeClusterMap]);

  // Custom link rendering for hover effect
  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const sourceX = link.source.x;
    const sourceY = link.source.y;
    const targetX = link.target.x;
    const targetY = link.target.y;

    ctx.beginPath();
    ctx.moveTo(sourceX, sourceY);
    ctx.lineTo(targetX, targetY);
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1.5 / globalScale;
    ctx.stroke();
  }, []);

  return (
    <div className="w-full h-full relative" style={{ cursor: mode === 'linking' ? 'crosshair' : mode === 'unlinking' ? 'crosshair' : mode === 'selecting' ? 'cell' : 'grab' }}>

      {/* --- Toolbar --- */}
      <div className="graph-toolbar">
        <button
          className={mode === 'linking' ? 'active' : ''}
          onClick={() => {
            if (mode === 'linking') {
              setMode('default');
              setLinkSource(null);
            } else {
              setMode('linking');
              setLinkSource(null);
            }
          }}
          title="Créer un lien entre 2 pages"
        >
          <Link2 size={15} />
          Nouveau lien
        </button>
        <button
          className={mode === 'unlinking' ? 'active' : ''}
          onClick={() => {
            if (mode === 'unlinking') {
              setMode('default');
              setUnlinkSource(null);
            } else {
              setMode('unlinking');
              setUnlinkSource(null);
            }
          }}
          title="Supprimer un lien entre 2 pages"
        >
          <Unlink size={15} />
          Supprimer lien
        </button>
        <button
          onClick={openNewCluster}
          className={mode === 'selecting' ? 'active' : ''}
          title="Créer un groupe de pages"
        >
          <Tag size={15} />
          Nouveau groupe
        </button>
      </div>

      {/* --- Mode indicators --- */}
      {mode === 'linking' && (
        <div className="graph-link-indicator">
          {linkSource
            ? `Cliquez sur le nœud cible (source: ${linkSource}) — Echap pour annuler`
            : 'Cliquez sur le nœud source — Echap pour annuler'}
        </div>
      )}
      {mode === 'unlinking' && (
        <div className="graph-unlink-indicator">
          {unlinkSource
            ? `Cliquez sur le second nœud pour supprimer le lien (source: ${unlinkSource}) — Echap pour annuler`
            : 'Cliquez sur le premier nœud du lien à supprimer — Echap pour annuler'}
        </div>
      )}
      {mode === 'selecting' && (
        <div className="graph-select-indicator">
          Cliquez sur les nœuds à ajouter au groupe ({clusterPanel.selectedPages.size} sélectionnés) — Echap pour annuler
        </div>
      )}

      {/* --- Force Graph --- */}
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        nodeLabel=""
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkCanvasObject={paintLink}
        linkPointerAreaPaint={(link: any, color: string, ctx: CanvasRenderingContext2D) => {
          const sx = link.source.x, sy = link.source.y;
          const tx = link.target.x, ty = link.target.y;
          const dx = tx - sx, dy = ty - sy;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) return;
          const nx = -dy / len * 4, ny = dx / len * 4;
          ctx.beginPath();
          ctx.moveTo(sx + nx, sy + ny);
          ctx.lineTo(tx + nx, ty + ny);
          ctx.lineTo(tx - nx, ty - ny);
          ctx.lineTo(sx - nx, sy - ny);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
        }}
        onNodeClick={handleNodeClick}
        onNodeRightClick={handleNodeRightClick}
        onLinkRightClick={handleLinkRightClick}
        onBackgroundClick={() => setContextMenu(null)}
        backgroundColor="#09090b"
      />

      {/* --- Context Menu --- */}
      {contextMenu && (
        <div
          className="graph-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'link' && contextMenu.linkData && (
            <button
              className="danger"
              onClick={() => handleDeleteLink(contextMenu.linkData!.source, contextMenu.linkData!.target)}
            >
              <Unlink size={15} />
              Supprimer ce lien
            </button>
          )}
          {contextMenu.type === 'node' && contextMenu.nodeData && (
            <>
              <button onClick={() => {
                loadPage(contextMenu.nodeData!.id);
                setViewMode('read');
                setContextMenu(null);
              }}>
                <Edit3 size={15} />
                Ouvrir la page
              </button>
              {clusters.length > 0 && (
                <>
                  <div className="separator" />
                  {clusters.map(cl => (
                    <button
                      key={cl.id}
                      onClick={() => handleAddToCluster(contextMenu.nodeData!.id, cl)}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: cl.color,
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      Ajouter à "{cl.label}"
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* --- Cluster Legend --- */}
      {clusters.length > 0 && (
        <div className="cluster-legend">
          <div className="cluster-legend-title">Groupes</div>
          {clusters.map(cl => (
            <div
              key={cl.id}
              className="cluster-legend-item"
              onClick={() => openEditCluster(cl)}
              title={`Cliquer pour modifier "${cl.label}"`}
            >
              <span className="cluster-legend-dot" style={{ background: cl.color }} />
              <span className="cluster-legend-label">{cl.label}</span>
              <span className="cluster-legend-count">{cl.pageIds.length}</span>
            </div>
          ))}
          <div
            className="cluster-legend-item"
            onClick={openNewCluster}
            style={{ marginTop: 4 }}
          >
            <Plus size={10} style={{ color: '#71717a' }} />
            <span className="cluster-legend-label" style={{ color: '#71717a' }}>Ajouter un groupe</span>
          </div>
        </div>
      )}

      {/* --- Cluster Panel --- */}
      {clusterPanel.open && (
        <div className="cluster-panel" onClick={(e) => e.stopPropagation()}>
          <div className="cluster-panel-title">
            {clusterPanel.editingCluster ? 'Modifier le groupe' : 'Nouveau groupe'}
          </div>

          <input
            type="text"
            placeholder="Nom du groupe..."
            value={clusterPanel.label}
            onChange={(e) => setClusterPanel(p => ({ ...p, label: e.target.value }))}
            autoFocus
          />

          <div className="cluster-panel-palette">
            {CLUSTER_PALETTE.map(color => (
              <div
                key={color}
                className={`cluster-panel-color ${clusterPanel.color === color ? 'selected' : ''}`}
                style={{ background: color }}
                onClick={() => setClusterPanel(p => ({ ...p, color }))}
              />
            ))}
          </div>

          <div className="cluster-panel-hint">
            Cliquez sur les nœuds du graphe pour les ajouter/retirer du groupe.
            {clusterPanel.selectedPages.size > 0 && (
              <span style={{ color: '#d4d4d8', fontWeight: 500 }}> ({clusterPanel.selectedPages.size} sélectionnés)</span>
            )}
          </div>

          <div className="cluster-panel-actions">
            {clusterPanel.editingCluster && (
              <button
                className="btn-delete"
                onClick={() => handleDeleteCluster(clusterPanel.editingCluster!.id)}
              >
                <Trash2 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                Supprimer
              </button>
            )}
            <button
              className="btn-cancel"
              onClick={() => {
                setClusterPanel({ open: false, editingCluster: null, label: '', color: CLUSTER_PALETTE[0], selectedPages: new Set() });
                setMode('default');
              }}
            >
              Annuler
            </button>
            <button
              className="btn-save"
              disabled={!clusterPanel.label.trim()}
              onClick={handleSaveCluster}
            >
              {clusterPanel.editingCluster ? 'Sauvegarder' : 'Créer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
