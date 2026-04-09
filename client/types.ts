export type Page = string;
export type LLMProvider = 'gemini' | 'lmstudio';

export interface ClusterInfo {
  id: string;
  label: string;
  color: string;
  pageIds: string[];
}

export interface WikiPage {
  id: string;
  content: string;
  clusters?: ClusterInfo[];
}
