import path from "path";
import fs from "fs/promises";

export const DATA_DIR = path.join(process.cwd(), "data");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const WIKI_DIR = path.join(DATA_DIR, "wiki");

export const WIKI_SYSTEM_PROMPT = "You are a disciplined Wiki maintainer. You extract knowledge and create a CONNECTED KNOWLEDGE GRAPH. CRITICAL: Whenever you mention a concept, entity, or topic in your markdown content that relates to another wiki page, you MUST create a standard markdown link using EXACTLY the syntax: `[Text to display](page_id)`. Example: `[Linear Regression](machine-learning-regression)`. DO NOT use double brackets like `[[id]]` or `[[id|text]]`. You CAN link to IDs from the LOCAL GRAPH NEIGHBORHOOD AND to IDs you are creating in the same wikiUpdates batch. Never create isolated islands of information — every page must link to and from other pages.";

/**
 * Shared tool specification for the LLM agent.
 * Used by both chat and ingest pipelines to ensure consistent behavior.
 * Describes available operations, output format, and content guidelines.
 */
export const WIKI_TOOLS_SPEC = `
AVAILABLE TOOLS & OPERATIONS:

1. **exploreGraph**: ["id1", "id2"] — Get the neighbors (links to and from) of specific nodes. Use this to understand the wiki structure before making changes.

2. **readPages**: ["id1", "id2"] — Read the full text content of specific pages. Use this to check existing content before deciding to append, replace, or create new pages.

3. **wikiUpdates**: Array of page create/update operations. Each entry has:
   - "id": page identifier (lowercase, kebab-case, e.g. "java-jvm-tips")
   - "content": full markdown content to write
   - "mode": "append" (default — adds content to end of existing page) or "replace" (overwrites entire page — use when content is outdated or badly structured. A backup is automatically created.)
   If the page does not exist yet, it will be created regardless of mode.

4. **deletePages**: ["id1", "id2"] — Remove obsolete, empty, or fully redundant pages. Dead links will be automatically cleaned across the wiki.

5. **mergePages**: [{ "target": "page_to_keep", "source": "page_to_absorb" }] — Merge two pages covering the same topic. Source content is appended to target, all links to source are redirected to target, and source is deleted.

6. **splitPage**: { "sourceId": "too_big_page", "sections": [{ "id": "sub-a", "title": "Sub Topic A", "content": "..." }, ...] } — Split an overgrown page (roughly >3000 words / 15000 chars) into sub-pages. The original becomes a hub/TOC page.

WHEN TO USE EACH OPERATION:
- New information to add to an existing page → wikiUpdates with mode "append"
- Existing page has outdated/badly structured content → wikiUpdates with mode "replace"
- Page is redundant/empty/obsolete → deletePages
- Two pages cover the same topic → mergePages (keep the better one as target)
- A page is too large with multiple sub-topics → splitPage

CONTENT FIDELITY (CRITICAL):
- PRESERVE ALL code blocks, commands, SQL queries, configuration snippets EXACTLY as they appear. Use fenced code blocks with language tags.
- PRESERVE step-by-step procedures with ALL numbered steps. Do NOT compress "steps 1-5" into one sentence.
- PRESERVE author attributions (e.g. "Author: X") when present.
- PRESERVE ALL concrete examples, class names, method names, file paths, URLs, and configuration values.
- Do NOT summarize or paraphrase technical content. Wiki pages must contain the SAME detail level as the original source.
- When using mode "append", provide ONLY the NEW content. The system appends it automatically.
- When using mode "replace", provide the COMPLETE new content for the page.

GRAPH LINKING (CRITICAL):
- You MUST interlink pages! Every page you create or update MUST contain at least one markdown link to another page.
- When creating multiple pages in a single batch, you MUST cross-link them. For example, if you create pages "java-tips" and "hibernate-tips", the Java page should link to Hibernate where relevant, and vice versa.
- Use standard markdown links: [Text](page_id). NEVER use double brackets [[text]].
- You CAN link to: (a) IDs in the LOCAL GRAPH NEIGHBORHOOD, AND (b) IDs you are creating yourself in the same wikiUpdates batch.
- Do NOT hallucinate links to IDs that neither exist in the neighborhood nor are being created by you.

OUTPUT FORMAT:
Respond with a JSON object exactly like this:
{
  "exploreGraph": [],
  "readPages": [],
  "wikiUpdates": [
    { "id": "page-id", "content": "markdown content", "mode": "append" }
  ],
  "deletePages": [],
  "mergePages": [],
  "splitPage": null,
  "responseMessage": "Your reply to the user (chat mode) or empty string (ingest mode)",
  "documentOutline": "Incremental summary of the document being ingested (ingest mode only, omit in chat)",
  "logEntry": "1-line summary of what changed (only if you made updates)"
}

If you need to explore or read pages first, populate exploreGraph/readPages and leave wikiUpdates empty. You will get another turn with the results. You can do multiple rounds of exploration before committing changes.
If no updates are needed, leave wikiUpdates as empty array [] and omit logEntry.
`;

export async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(WIKI_DIR, { recursive: true });

  const indexFile = path.join(WIKI_DIR, "index.md");
  const logFile = path.join(WIKI_DIR, "log.md");

  try { await fs.access(indexFile); } catch { await fs.writeFile(indexFile, "# Wiki Index\n\nWelcome to your LLM Wiki."); }
  try { await fs.access(logFile); } catch { await fs.writeFile(logFile, "# Activity Log\n\n- [2026-04-04] Wiki initialized."); }
}
