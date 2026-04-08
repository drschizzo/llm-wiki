export type Page = string;
export type LLMProvider = 'gemini' | 'lmstudio';

export interface WikiPage {
  id: string;
  content: string;
}
