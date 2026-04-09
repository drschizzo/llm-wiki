import { Router } from "express";
import { loadGraph } from "../services/graph.service";
import { addLinkToPage, removeLinkFromPage } from "../services/wiki.service";
import { loadClusters } from "../services/cluster.service";

export const graphRouter = Router();

// Get whole visual graph (enriched with cluster data)
graphRouter.get("/", async (req, res) => {
  try {
    const graph = await loadGraph();
    const clustersData = await loadClusters();

    // Ignore index and log pages as they are uninformative "supernodes"
    const ignoredNodes = new Set(['index', 'log']);

    const formattedNodes = Object.values(graph.nodes)
      .filter(n => !ignoredNodes.has(n.id))
      .map(n => ({ id: n.id, name: n.title }));

    const formattedLinks: { source: string, target: string }[] = [];
    for (const [source, targets] of Object.entries(graph.edges)) {
      if (ignoredNodes.has(source)) continue;
      for (const target of targets) {
        if (graph.nodes[target] && !ignoredNodes.has(target)) {
          formattedLinks.push({ source, target });
        }
      }
    }

    res.json({
      nodes: formattedNodes,
      links: formattedLinks,
      clusters: clustersData.clusters,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load graph" });
  }
});

// Create a link between two pages
graphRouter.post("/link", async (req, res) => {
  const { source, target } = req.body;
  if (!source || !target) {
    return res.status(400).json({ error: "source and target are required" });
  }
  try {
    const result = await addLinkToPage(source, target);
    if (!result.success) {
      return res.status(404).json({ error: "One or both pages not found" });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create link", details: err.message });
  }
});

// Delete a link between two pages
graphRouter.delete("/link", async (req, res) => {
  const { source, target } = req.body;
  if (!source || !target) {
    return res.status(400).json({ error: "source and target are required" });
  }
  try {
    const result = await removeLinkFromPage(source, target);
    if (!result.success) {
      return res.status(404).json({ error: "Source page not found" });
    }
    res.json({ success: true, removed: result.removed });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete link", details: err.message });
  }
});
