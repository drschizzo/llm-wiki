import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { DATA_DIR } from "../config";

export interface Cluster {
  id: string;
  label: string;
  color: string;
  pageIds: string[];
}

export interface ClustersData {
  clusters: Cluster[];
}

const CLUSTERS_FILE = path.join(DATA_DIR, "clusters.json");

// Curated palette of 10 harmonious colors
export const CLUSTER_PALETTE = [
  "#8b5cf6", // violet
  "#3b82f6", // blue
  "#06b6d4", // cyan
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#f97316", // orange
  "#14b8a6", // teal
  "#a855f7", // purple
];

export async function loadClusters(): Promise<ClustersData> {
  try {
    const data = await fs.readFile(CLUSTERS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { clusters: [] };
  }
}

async function saveClusters(data: ClustersData): Promise<void> {
  await fs.writeFile(CLUSTERS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function addCluster(label: string, color: string, pageIds: string[]): Promise<Cluster> {
  const data = await loadClusters();
  const cluster: Cluster = {
    id: crypto.randomUUID(),
    label,
    color,
    pageIds,
  };
  data.clusters.push(cluster);
  await saveClusters(data);
  console.log(`[Cluster] Created cluster "${label}" with ${pageIds.length} pages`);
  return cluster;
}

export async function updateCluster(
  id: string,
  updates: Partial<Pick<Cluster, "label" | "color" | "pageIds">>
): Promise<Cluster | null> {
  const data = await loadClusters();
  const idx = data.clusters.findIndex((c) => c.id === id);
  if (idx === -1) return null;

  if (updates.label !== undefined) data.clusters[idx].label = updates.label;
  if (updates.color !== undefined) data.clusters[idx].color = updates.color;
  if (updates.pageIds !== undefined) data.clusters[idx].pageIds = updates.pageIds;

  await saveClusters(data);
  console.log(`[Cluster] Updated cluster "${data.clusters[idx].label}"`);
  return data.clusters[idx];
}

export async function deleteCluster(id: string): Promise<boolean> {
  const data = await loadClusters();
  const before = data.clusters.length;
  data.clusters = data.clusters.filter((c) => c.id !== id);
  if (data.clusters.length === before) return false;
  await saveClusters(data);
  console.log(`[Cluster] Deleted cluster ${id}`);
  return true;
}

export async function getClustersForPage(pageId: string): Promise<Cluster[]> {
  const data = await loadClusters();
  return data.clusters.filter((c) => c.pageIds.includes(pageId));
}
