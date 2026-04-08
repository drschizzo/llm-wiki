import { Router } from "express";
import { loadGraph } from "../services/graph.service";

export const graphRouter = Router();

// Get whole visual graph
graphRouter.get("/", async (req, res) => {
  try {
    const graph = await loadGraph();
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

    res.json({ nodes: formattedNodes, links: formattedLinks });
  } catch (err) {
    res.status(500).json({ error: "Failed to load graph" });
  }
});
