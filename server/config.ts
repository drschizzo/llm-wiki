import path from "path";
import fs from "fs/promises";

export const DATA_DIR = path.join(process.cwd(), "data");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const WIKI_DIR = path.join(DATA_DIR, "wiki");

export const WIKI_SYSTEM_PROMPT = "You are a disciplined Wiki maintainer. You extract knowledge and create a CONNECTED KNOWLEDGE GRAPH. CRITICAL: Whenever you mention a concept, entity, or topic in your markdown content that exists in the local knowledge graph, you MUST create a standard markdown link to it using EXACTLY the syntax: `[Text to display](id_from_graph)`. Example: `[Linear Regression](machine-learning-regression)`. DO NOT use double brackets like `[[id]]` or `[[id|text]]`. DO NOT link to any concept or ID that does not exist in the PROVIDED GRAPH, unless you are creating it in the 'updates' array. Never create isolated islands of information.";

export async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(WIKI_DIR, { recursive: true });

  const indexFile = path.join(WIKI_DIR, "index.md");
  const logFile = path.join(WIKI_DIR, "log.md");

  try { await fs.access(indexFile); } catch { await fs.writeFile(indexFile, "# Wiki Index\n\nWelcome to your LLM Wiki."); }
  try { await fs.access(logFile); } catch { await fs.writeFile(logFile, "# Activity Log\n\n- [2026-04-04] Wiki initialized."); }
}
