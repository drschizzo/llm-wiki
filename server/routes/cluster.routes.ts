import { Router } from "express";
import {
  loadClusters,
  addCluster,
  updateCluster,
  deleteCluster,
  CLUSTER_PALETTE,
} from "../services/cluster.service";

export const clusterRouter = Router();

// List all clusters + the available palette
clusterRouter.get("/", async (_req, res) => {
  try {
    const data = await loadClusters();
    res.json({ clusters: data.clusters, palette: CLUSTER_PALETTE });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load clusters", details: err.message });
  }
});

// Create a cluster
clusterRouter.post("/", async (req, res) => {
  const { label, color, pageIds } = req.body;
  if (!label || !color) {
    return res.status(400).json({ error: "label and color are required" });
  }
  try {
    const cluster = await addCluster(label, color, pageIds || []);
    res.json({ success: true, cluster });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create cluster", details: err.message });
  }
});

// Update a cluster
clusterRouter.put("/:id", async (req, res) => {
  const { label, color, pageIds } = req.body;
  try {
    const cluster = await updateCluster(req.params.id, { label, color, pageIds });
    if (!cluster) return res.status(404).json({ error: "Cluster not found" });
    res.json({ success: true, cluster });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update cluster", details: err.message });
  }
});

// Delete a cluster
clusterRouter.delete("/:id", async (req, res) => {
  try {
    const deleted = await deleteCluster(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Cluster not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete cluster", details: err.message });
  }
});
