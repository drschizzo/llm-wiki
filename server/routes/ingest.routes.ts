import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import multer from "multer";
import axios from "axios";
import * as cheerio from "cheerio";
import AdmZip from "adm-zip";
import { DATA_DIR, RAW_DIR, WIKI_DIR, WIKI_SYSTEM_PROMPT, WIKI_TOOLS_SPEC } from "../config";
import { callLLM } from "../services/llm.service";
import { loadGraph, getSubgraphForText, getPageSnippet } from "../services/graph.service";
import { applyWikiUpdates, appendToLog, getFileHash, loadProcessedHashes, saveProcessedHash, deletePage, mergePages, splitPage } from "../services/wiki.service";

export const ingestRouter = Router();
const upload = multer({ dest: RAW_DIR });

// --- Shared agentic loop for ingestion ---

const MAX_AGENT_LOOPS = 4;

/**
 * Runs an agentic LLM loop (explore → read → act) on a given prompt/context.
 * Same loop structure as chat, but without user interaction.
 * Returns all accumulated operations from all loop iterations.
 */
async function runAgentLoop(
  provider: string,
  initialPrompt: string,
  systemPrompt: string,
  imagePayload?: { base64: string; mimeType: string }
): Promise<{
  allWikiUpdates: any[];
  allDeletePages: string[];
  allMergePages: { target: string; source: string }[];
  pendingSplit: any | null;
  documentOutline: string;
  logEntry: string;
}> {
  let currentPrompt = initialPrompt;
  let allWikiUpdates: any[] = [];
  let allDeletePages: string[] = [];
  let allMergePages: { target: string; source: string }[] = [];
  let pendingSplit: any | null = null;
  let documentOutline = "";
  let logEntry = "";

  const fullGraph = await loadGraph();

  for (let loop = 0; loop < MAX_AGENT_LOOPS; loop++) {
    const parsed = await callLLM(provider, currentPrompt, systemPrompt, true, loop === 0 ? imagePayload : undefined);

    // Collect wiki updates
    if (parsed.wikiUpdates && parsed.wikiUpdates.length > 0) {
      for (const update of parsed.wikiUpdates) {
        const existingIdx = allWikiUpdates.findIndex((u: any) => u.id === update.id);
        if (existingIdx >= 0) allWikiUpdates[existingIdx] = update;
        else allWikiUpdates.push(update);
      }
    }

    // Collect restructuring ops
    if (parsed.deletePages && Array.isArray(parsed.deletePages)) {
      allDeletePages.push(...parsed.deletePages);
    }
    if (parsed.mergePages && Array.isArray(parsed.mergePages)) {
      allMergePages.push(...parsed.mergePages);
    }
    if (parsed.splitPage && parsed.splitPage.sourceId && parsed.splitPage.sections) {
      pendingSplit = parsed.splitPage;
    }

    // Track outline and log
    if (parsed.documentOutline) documentOutline = parsed.documentOutline;
    if (parsed.logEntry) logEntry = parsed.logEntry;

    // Check if agent wants to explore/read more
    const requestedPages = parsed.readPages || [];
    const requestedExplore = parsed.exploreGraph || [];

    if (requestedPages.length > 0 || requestedExplore.length > 0) {
      let extraContext = "\n\n[System: Action Results:]\n";

      for (const id of requestedExplore) {
        const nodeSubgraph = await getSubgraphForText(id + " " + (fullGraph.nodes[id]?.title || ""), fullGraph, 20);
        extraContext += `\n--- GRAPH EXPLORATION: ${id} ---\n${nodeSubgraph}\n`;
      }

      for (const pageId of requestedPages) {
        const content = await fs.readFile(path.join(WIKI_DIR, `${pageId}.md`), "utf-8").catch(() => null);
        if (content) {
          extraContext += `\n--- PAGE: ${pageId} ---\n${content}\n`;
        } else {
          extraContext += `\n--- PAGE: ${pageId} ---\n(Page does not exist)\n`;
        }
      }

      extraContext += "\nNow provide your \"wikiUpdates\" and any restructuring operations. If you STILL need to explore/read more, leave wikiUpdates empty and populate exploreGraph/readPages again.\nAssistant:";
      currentPrompt += extraContext;
    } else {
      break; // Agent is done
    }
  }

  return { allWikiUpdates, allDeletePages, allMergePages, pendingSplit, documentOutline, logEntry };
}

/**
 * Executes the accumulated restructuring operations in the correct order.
 */
async function executeRestructuringOps(
  allDeletePages: string[],
  allMergePages: { target: string; source: string }[],
  pendingSplit: any | null
): Promise<Set<string>> {
  const affectedPages = new Set<string>();

  // 1. Merges first
  for (const merge of allMergePages) {
    const result = await mergePages(merge.target, merge.source);
    if (result.success) {
      affectedPages.add(merge.target);
      console.log(`[Ingest] Merged "${merge.source}" into "${merge.target}" (${result.rewrittenLinks} links rewritten)`);
    }
  }

  // 2. Split
  if (pendingSplit && pendingSplit.sourceId && pendingSplit.sections) {
    const result = await splitPage(pendingSplit.sourceId, pendingSplit.sections);
    if (result.success) {
      affectedPages.add(pendingSplit.sourceId);
      for (const p of result.createdPages) affectedPages.add(p);
      console.log(`[Ingest] Split "${pendingSplit.sourceId}" into ${result.createdPages.length} sub-pages`);
    }
  }

  // 3. Deletes last
  for (const pageId of allDeletePages) {
    const result = await deletePage(pageId);
    if (result.success) {
      console.log(`[Ingest] Deleted page "${pageId}" (${result.removedLinks} dead links cleaned)`);
    }
  }

  return affectedPages;
}

// --- Post-ingestion consolidation pass ---

/**
 * After ingesting a file, reviews all pages that were just created/updated
 * and asks the LLM to identify near-duplicates or pages that should be merged.
 * This is a general-purpose deduplication mechanism that works regardless
 * of document format or content type.
 */
async function runConsolidationPass(
  provider: string,
  pageIds: string[]
): Promise<void> {
  // Filter out system pages and deduplicate
  const uniquePages = [...new Set(pageIds)].filter(id => id !== 'index' && id !== 'log');
  
  // Only consolidate if there are at least 3 pages (otherwise merging is unlikely needed)
  if (uniquePages.length < 3) return;

  console.log(`[Consolidation] Reviewing ${uniquePages.length} pages for potential merges...`);

  // Build a summary of all pages for the LLM
  const currentGraph = await loadGraph();
  let pageSummaries = "";
  for (const pageId of uniquePages) {
    const node = currentGraph.nodes[pageId];
    const title = node?.title || pageId;
    const snippet = await getPageSnippet(pageId, 300);
    const links = currentGraph.edges[pageId] || [];
    pageSummaries += `- ID: "${pageId}" | Title: "${title}" | Preview: "${snippet}" | Links: [${links.join(', ')}]\n`;
  }

  const prompt = `You just helped ingest a document and the following wiki pages were created or updated:

${pageSummaries}

TASK: Review these pages for quality and coherence. Identify any issues:
1. **Near-duplicate pages**: Two pages covering essentially the same topic with different IDs (e.g. "config-ide" and "intellij-config" are likely duplicates). These MUST be merged.
2. **Pages that are too small** to stand alone (less than ~100 words of useful content) and should be merged into a related, larger page.

For each issue found, use the appropriate operation:
- "mergePages" to combine near-duplicates (keep the one with the better ID/title as target)
- "wikiUpdates" with mode "replace" if a page needs its content restructured after a merge

If no issues are found, return empty arrays.

Respond with JSON:
{
  "mergePages": [{ "target": "page_to_keep", "source": "page_to_absorb" }],
  "wikiUpdates": [],
  "deletePages": [],
  "logEntry": "1-line description of consolidation actions taken, or empty if none"
}`;

  try {
    const parsed = await callLLM(provider, prompt, WIKI_SYSTEM_PROMPT, true);
    
    let actionsPerformed = false;

    // Execute merges
    if (parsed.mergePages && Array.isArray(parsed.mergePages) && parsed.mergePages.length > 0) {
      for (const merge of parsed.mergePages) {
        if (merge.target && merge.source) {
          const result = await mergePages(merge.target, merge.source);
          if (result.success) {
            actionsPerformed = true;
            console.log(`[Consolidation] Merged "${merge.source}" into "${merge.target}" (${result.rewrittenLinks} links rewritten)`);
          }
        }
      }
    }

    // Execute any content updates
    if (parsed.wikiUpdates && parsed.wikiUpdates.length > 0) {
      await applyWikiUpdates(parsed.wikiUpdates);
      actionsPerformed = true;
    }

    // Execute deletes
    if (parsed.deletePages && Array.isArray(parsed.deletePages) && parsed.deletePages.length > 0) {
      for (const pageId of parsed.deletePages) {
        const result = await deletePage(pageId);
        if (result.success) {
          actionsPerformed = true;
          console.log(`[Consolidation] Deleted "${pageId}"`);
        }
      }
    }

    if (parsed.logEntry && actionsPerformed) {
      await appendToLog(`[Consolidation] ${parsed.logEntry}`);
    }

    if (!actionsPerformed) {
      console.log(`[Consolidation] No issues found.`);
    }
  } catch (err: any) {
    console.error(`[Consolidation] Failed: ${err.message} — skipping.`);
  }
}

// --- Simple size-based chunking (only used when content exceeds MAX_CHUNK_LENGTH) ---

function chunkBySize(content: string, maxChunkLength: number): string[] {
  if (content.length <= maxChunkLength) return [content];

  const chunks: string[] = [];
  let r = 0;
  while (r < content.length) {
    let end = Math.min(r + maxChunkLength, content.length);
    if (end < content.length) {
      const lastNewline = content.lastIndexOf('\n', end);
      if (lastNewline > r + maxChunkLength * 0.8) {
        end = lastNewline + 1;
      }
    }
    chunks.push(content.substring(r, end));
    r = end;
  }
  return chunks;
}

// --- Helper to recursively list files (for zip extraction) ---

async function processFilesRecursive(dir: string): Promise<string[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  let files: string[] = [];
  for (const dirent of dirents) {
    const res = path.resolve(dir, dirent.name);
    if (dirent.name === '.DS_Store' || dirent.name.startsWith('__MACOSX')) continue;
    if (dirent.isDirectory()) {
      files = files.concat(await processFilesRecursive(res));
    } else {
      files.push(res);
    }
  }
  return files;
}

// --- Ingest URL ---

ingestRouter.post("/url", async (req, res) => {
  const { url, provider = "gemini" } = req.body;
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const title = $("title").text();
    const text = $("body").text().replace(/\s+/g, ' ').trim();

    const fullGraph = await loadGraph();
    const localGraphContext = await getSubgraphForText(text.substring(0, 3000), fullGraph, 30);

    const prompt = `I have a new web source to ingest into the wiki.
Title: "${title}"
URL: ${url}
Content:
${text.substring(0, 5000)}

${localGraphContext}

${WIKI_TOOLS_SPEC}

INGEST INSTRUCTIONS:
1. Analyze this content and organize it into appropriate wiki pages.
2. Check the LOCAL GRAPH NEIGHBORHOOD to see if existing pages already cover these topics — reuse/append to them instead of creating duplicates.
3. Ensure all new pages are linked to the existing graph.
4. For any new page you create, append \`\\n\\n---\\n**Source:** [${url}](${url})\` at the bottom of the content.
5. Do NOT use "responseMessage" — this is an automated ingestion, not a chat.`;

    const result = await runAgentLoop(provider, prompt, WIKI_SYSTEM_PROMPT);

    if (result.allWikiUpdates.length > 0) {
      await applyWikiUpdates(result.allWikiUpdates);
    }
    await executeRestructuringOps(result.allDeletePages, result.allMergePages, result.pendingSplit);
    if (result.logEntry) await appendToLog(result.logEntry);

    const updatedPages = result.allWikiUpdates.map((u: any) => u.id).filter(Boolean);

    res.json({ success: true, updatedPages });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to ingest URL", details: err.message });
  }
});

// --- Ingest Files ---

ingestRouter.post("/files", upload.array("files"), async (req, res) => {
  const uploadedFiles = (req as any).files as any[];
  const provider = req.body.provider || "gemini";

  try {
    const updatedPages: string[] = [];
    let filesToProcess: { path: string, originalname: string, safeName: string, mtimeMs: number }[] = [];

    for (const file of uploadedFiles) {
      if (file.originalname.toLowerCase().endsWith('.zip')) {
        const zipPath = file.path;
        const extractPath = path.join(DATA_DIR, "tmp_unzip", `${Date.now()}`);
        await fs.mkdir(extractPath, { recursive: true });

        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractPath, true);

        const unzippedFiles = await processFilesRecursive(extractPath);
        for (const uf of unzippedFiles) {
          const ext = path.extname(uf);
          const baseName = path.basename(uf, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
          const safeName = `${Date.now()}-${baseName}${ext}`;
          const targetPath = path.join(RAW_DIR, safeName);
          await fs.copyFile(uf, targetPath);
          const stat = await fs.stat(targetPath);
          filesToProcess.push({ path: targetPath, originalname: path.basename(uf), safeName: safeName, mtimeMs: stat.mtimeMs });
        }
      } else {
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeName = `${Date.now()}-${baseName}${ext}`;
        const targetPath = path.join(RAW_DIR, safeName);
        await fs.rename(file.path, targetPath);
        const stat = await fs.stat(targetPath);
        filesToProcess.push({ path: targetPath, originalname: file.originalname, safeName: safeName, mtimeMs: stat.mtimeMs });
      }
    }

    // Sort chronologically ascending
    filesToProcess.sort((a, b) => a.mtimeMs - b.mtimeMs);

    const processedHashes = await loadProcessedHashes();
    console.log(`[Batch] Found ${filesToProcess.length} files to process.`);

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      const logPrefix = `[Batch] ${i + 1}/${filesToProcess.length}`;

      try {
        const fileHash = await getFileHash(file.path);
        if (processedHashes.includes(fileHash)) {
          console.log(`${logPrefix} - Skipping "${file.originalname}" (Already processed).`);
          continue;
        }

        console.log(`${logPrefix} - Processing "${file.originalname}"...`);

        const fileUpdatedPages: string[] = [];
        const ext = path.extname(file.originalname).toLowerCase();

        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          // --- Image ingestion ---
          const fileBuffer = await fs.readFile(file.path);
          const imagePayload = { base64: fileBuffer.toString("base64"), mimeType: `image/${ext.slice(1).replace('jpg', 'jpeg')}` };

          const fullGraph = await loadGraph();
          const localGraphContext = await getSubgraphForText(file.originalname, fullGraph, 30);

          const prompt = `I have a new image source named "${file.originalname}" to ingest into the wiki.
Please analyze this image, extract the knowledge or diagrams it contains.

${localGraphContext}

${WIKI_TOOLS_SPEC}

INGEST INSTRUCTIONS:
1. Create wiki page(s) documenting this image's content. Check the LOCAL GRAPH NEIGHBORHOOD to see if existing pages already cover this topic.
2. Ensure all new pages link to the existing graph.
3. For any new page, append \`\\n\\n---\\n**Source:** [${file.originalname}](/raw/${file.safeName})\\n\\n![${file.originalname}](/raw/${file.safeName})\` at the bottom.
4. Do NOT use "responseMessage".`;

          const result = await runAgentLoop(provider, prompt, WIKI_SYSTEM_PROMPT, imagePayload);

          if (result.allWikiUpdates.length > 0) {
            await applyWikiUpdates(result.allWikiUpdates);
            const pageIds = result.allWikiUpdates.map((u: any) => u.id).filter(Boolean);
            updatedPages.push(...pageIds);
            fileUpdatedPages.push(...pageIds);
          }
          await executeRestructuringOps(result.allDeletePages, result.allMergePages, result.pendingSplit);
          if (result.logEntry) await appendToLog(result.logEntry);

          console.log(`${logPrefix} - Image processed. Pages: ${fileUpdatedPages.join(', ')}`);

        } else {
          // --- Text file ingestion ---
          try {
            const content = await fs.readFile(file.path, "utf-8");
            const MAX_CHUNK_LENGTH = process.env.MAX_CHUNK_LENGTH ? parseInt(process.env.MAX_CHUNK_LENGTH) : 30000;
            const chunks = chunkBySize(content, MAX_CHUNK_LENGTH);

            console.log(`${logPrefix} - ${chunks.length === 1 ? 'Single chunk' : `Split into ${chunks.length} chunks`}.`);

            // Incremental document outline — built across chunks for context continuity
            let documentOutline = "";

            for (let part = 0; part < chunks.length; part++) {
              const chunkText = chunks[part];
              const chunkLogPrefix = chunks.length > 1 ? `${logPrefix} (Chunk ${part + 1}/${chunks.length})` : logPrefix;

              console.log(`${chunkLogPrefix} - Processing...`);

              // Reload graph per-chunk so pages created in previous chunks are visible
              const currentGraph = await loadGraph();
              const localGraphContext = await getSubgraphForText(chunkText.substring(0, 5000), currentGraph, 30);

              let prompt = `I have a source file named "${file.originalname}" to ingest into the wiki.\n`;

              if (chunks.length > 1) {
                prompt += `This is CHUNK ${part + 1} of ${chunks.length} of a large document.\n`;
                if (documentOutline) {
                  prompt += `\nDOCUMENT OUTLINE (built from previous chunks — use this to understand the full document context and avoid creating redundant pages):\n${documentOutline}\n\n`;
                }
              }

              prompt += `Content:\n${chunkText}\n\n${localGraphContext}\n\n${WIKI_TOOLS_SPEC}\n`;

              prompt += `\nINGEST INSTRUCTIONS:\n`;
              prompt += `1. Analyze this content and organize it into appropriate wiki pages. Trust your judgment to decide the best page structure.\n`;
              prompt += `2. Check the LOCAL GRAPH NEIGHBORHOOD to see if existing pages already cover these topics — reuse/append to them instead of creating duplicates.\n`;
              prompt += `3. Ensure all pages are well-linked to the existing graph.\n`;
              prompt += `4. Do NOT use "responseMessage" — this is automated ingestion.\n`;

              if (chunks.length > 1) {
                prompt += `5. IMPORTANT: You MUST return a "documentOutline" field — a brief, structured summary of ALL topics you have encountered so far (including from previous chunks if any outline was provided). This outline will be passed to subsequent chunks as context. Format it as a compact bullet list.\n`;
              }

              const result = await runAgentLoop(provider, prompt, WIKI_SYSTEM_PROMPT);

              // Track incremental outline for next chunks
              if (result.documentOutline) {
                documentOutline = result.documentOutline;
              }

              if (result.allWikiUpdates.length > 0) {
                await applyWikiUpdates(result.allWikiUpdates);
                const pageIds = result.allWikiUpdates.map((u: any) => u.id).filter(Boolean);
                updatedPages.push(...pageIds);
                fileUpdatedPages.push(...pageIds);
              }
              await executeRestructuringOps(result.allDeletePages, result.allMergePages, result.pendingSplit);
              if (result.logEntry) await appendToLog(result.logEntry);

              console.log(`${chunkLogPrefix} - Success.`);
            }
          } catch (readErr: any) {
            console.error(`${logPrefix} - FAILED reading "${file.originalname}" as text: ${readErr.message}`);
            continue;
          }
        }

        // --- Post-ingestion consolidation pass ---
        await runConsolidationPass(provider, fileUpdatedPages);

        // Programmatic Provenance: Append source to all pages touched by this file
        try {
          const uniquePagesForFile = [...new Set(fileUpdatedPages)];
          const sourceBlock = `\n\n---\n**Source:** [${file.originalname}](/raw/${file.safeName})`;
          for (const pageId of uniquePagesForFile) {
            if (pageId === "index" || pageId === "log") continue;
            const pagePath = path.join(WIKI_DIR, `${pageId}.md`);
            try {
              const pageContent = await fs.readFile(pagePath, "utf-8");
              if (!pageContent.includes(`**Source:** [${file.originalname}]`)) {
                await fs.writeFile(pagePath, pageContent + sourceBlock, "utf-8");
              }
            } catch (e) {}
          }
        } catch (e) {}

        await saveProcessedHash(fileHash);
        processedHashes.push(fileHash);
      } catch (fileErr: any) {
        console.error(`${logPrefix} - FAILED processing "${file.originalname}": ${fileErr.message} -> Continuing...`);
      }
    }

    // Cleanup
    try { await fs.rm(path.join(DATA_DIR, "tmp_unzip"), { recursive: true, force: true }); } catch (e) { }

    res.json({ success: true, updatedPages: updatedPages.filter(Boolean) });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to ingest files", details: err.message });
  }
});
