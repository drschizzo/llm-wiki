export interface GraphNode {
  id: string;
  title: string;
}

export interface WikiGraph {
  nodes: Record<string, GraphNode>;
  edges: Record<string, string[]>;
}
