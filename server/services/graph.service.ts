import fs from "fs/promises";
import path from "path";
import { DATA_DIR, WIKI_DIR } from "../config";
import { WikiGraph } from "../types";

export const GRAPH_DB_FILE = path.join(DATA_DIR, "graph.json");

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9àâäéèêëïîôöùûüÿç]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

export async function buildGraphFull(): Promise<WikiGraph> {
  const files = await fs.readdir(WIKI_DIR).catch(() => []);
  const graph: WikiGraph = { nodes: {}, edges: {} };

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const id = file.replace('.md', '');
    const content = await fs.readFile(path.join(WIKI_DIR, file), 'utf-8').catch(() => "");

    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : id;

    graph.nodes[id] = { id, title };
    graph.edges[id] = [];

    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      let targetId = match[2].trim();
      if (targetId.endsWith('.md')) targetId = targetId.slice(0, -3);
      if (targetId.startsWith('#') || targetId.startsWith('http')) continue;

      if (!graph.edges[id].includes(targetId)) {
        graph.edges[id].push(targetId);
      }
    }
  }

  await fs.writeFile(GRAPH_DB_FILE, JSON.stringify(graph, null, 2), "utf-8").catch(() => { });

  // Auto-generate algorithmic index.md
  const allNodes = Object.values(graph.nodes).filter(n => n.id !== 'index' && n.id !== 'log');
  allNodes.sort((a, b) => a.title.localeCompare(b.title));

  let indexMdContent = `> **Auto-Generated Index** - This page is automatically compiled from the Graph Database.\n\n# Wiki Index\n\n`;
  let currentLetter = '';

  for (const node of allNodes) {
    const firstChar = node.title.charAt(0).toUpperCase();
    const groupChar = /[A-Z0-9]/.test(firstChar) ? firstChar : '#';

    if (groupChar !== currentLetter) {
      currentLetter = groupChar;
      indexMdContent += `\n## ${currentLetter}\n`;
    }
    indexMdContent += `- [${node.title}](${node.id})\n`;
  }

  await fs.writeFile(path.join(WIKI_DIR, "index.md"), indexMdContent, "utf-8").catch(() => { });

  return graph;
}

export async function loadGraph(): Promise<WikiGraph> {
  try {
    const data = await fs.readFile(GRAPH_DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return await buildGraphFull();
  }
}

export function getSubgraphForText(text: string, graph: WikiGraph, maxNodes: number = 30): string {
  const textTokens = new Set(tokenize(text));

  const scores = Object.values(graph.nodes).map(node => {
    let score = 0;
    const itemTokens = tokenize(node.title + " " + node.id);
    for (const token of itemTokens) {
      if (textTokens.has(token)) score++;
    }
    return { id: node.id, score };
  });

  scores.sort((a, b) => b.score - a.score);

  const localSet = new Set<string>();
  for (let i = 0; i < Math.min(scores.length, maxNodes / 2); i++) {
    if (scores[i].score > 0) localSet.add(scores[i].id);
  }

  if (graph.nodes['index']) localSet.add('index');

  const expandedSet = new Set<string>(localSet);
  for (const id of localSet) {
    if (graph.edges[id]) {
      for (const target of graph.edges[id]) expandedSet.add(target);
    }
    for (const [sourceId, targets] of Object.entries(graph.edges)) {
      if (targets.includes(id)) expandedSet.add(sourceId);
    }
  }

  let output = "=== LOCAL GRAPH NEIGHBORHOOD ===\n";
  let added = 0;
  for (const id of expandedSet) {
    if (added >= maxNodes) break;
    const node = graph.nodes[id];
    if (!node) continue;
    const outs = graph.edges[id] || [];
    output += `ID: ${id} | Title: "${node.title}" | Links_to: [${outs.join(', ')}]\n`;
    added++;
  }

  if (added === 0) return "=== LOCAL GRAPH NEIGHBORHOOD ===\n(Empty Graph)";
  return output;
}
