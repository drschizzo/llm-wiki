import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import multer from "multer";
import axios from "axios";
import * as cheerio from "cheerio";
import AdmZip from "adm-zip";
import { DATA_DIR, RAW_DIR, WIKI_DIR, WIKI_SYSTEM_PROMPT } from "../config";
import { callLLM } from "../services/llm.service";
import { loadGraph, getSubgraphForText } from "../services/graph.service";
import { applyWikiUpdates, appendToLog, getFileHash, loadProcessedHashes, saveProcessedHash } from "../services/wiki.service";

export const ingestRouter = Router();
const upload = multer({ dest: RAW_DIR });

// Ingest URL
ingestRouter.post("/url", async (req, res) => {
  const { url, provider = "gemini" } = req.body;
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const title = $("title").text();
    const text = $("body").text().replace(/\s+/g, ' ').trim();

    // Read current index to give LLM context
    const indexContent = await fs.readFile(path.join(WIKI_DIR, "index.md"), "utf-8").catch(() => "# Wiki Index");

    const prompt = `I have a new source titled "${title}". 
    Content: ${text.substring(0, 5000)}
    
    CURRENT WIKI INDEX (index.md):
    ${indexContent}
    
    Please:
    1. Create a summary page for this source.
    2. Identify key entities and concepts.
    3. Update the existing index.md to include the new summary page and any new concepts, categorized appropriately.
    4. Suggest updates for other existing wiki pages or new pages to create.
    
    Format your response as a JSON object exactly like this:
    {
      "summaryPage": { "id": "string", "content": "markdown" },
      "updates": [ { "id": "string", "content": "markdown" } ],
      "logEntry": "string (a 1-line description of what was ingested)"
    }
    
    Ensure that one of the items in "updates" has the id "index" containing the full updated content of index.md.
    5. Append \`\n\n---\n**Source:** [${url}](${url})\` to the bottom of the content of the summaryPage you create.`;

    const parsed = await callLLM(provider, prompt, WIKI_SYSTEM_PROMPT, true);
    await applyWikiUpdates([parsed.summaryPage, ...(parsed.updates || [])]);
    if (parsed.logEntry) await appendToLog(parsed.logEntry);

    res.json({
      success: true,
      updatedPages: [parsed.summaryPage?.id, ...(parsed.updates || []).map((u: any) => u.id)].filter(Boolean)
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to ingest URL", details: err.message });
  }
});

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

/**
 * Adaptive content splitting: tries semantic section detection first,
 * falls back to size-based chunking.
 *
 * Level 1: H2 markdown headers (## ) — needs at least 3 occurrences
 * Level 2: Separators (--- or ===) — needs at least 2 occurrences
 * Fallback: raw size-based chunking (existing behavior)
 *
 * Post-processing:
 * - Sections < 200 chars are merged with the next section
 * - Sections > maxChunkLength are re-split by size
 */
function splitIntoSections(content: string, maxChunkLength: number): { chunks: string[], isStructural: boolean } {
  let sections: string[] = [];
  let isStructural = false;

  // Level 1: H2 markdown headers (## )
  const h2Regex = /^## /gm;
  const h2Positions: number[] = [];
  let match;
  while ((match = h2Regex.exec(content)) !== null) {
    h2Positions.push(match.index);
  }

  if (h2Positions.length >= 3) {
    isStructural = true;
    // Text before the first H2 is the introduction
    const intro = content.substring(0, h2Positions[0]).trim();
    if (intro.length > 0) sections.push(intro);
    // Each H2 section runs until the next H2 or end of file
    for (let i = 0; i < h2Positions.length; i++) {
      const start = h2Positions[i];
      const end = i + 1 < h2Positions.length ? h2Positions[i + 1] : content.length;
      sections.push(content.substring(start, end).trim());
    }
  } else {
    // Level 2: Separators (--- or ===, at least 3 chars on their own line)
    const sepRegex = /^-{3,}$|^={3,}$/gm;
    const sepPositions: { start: number; end: number }[] = [];
    while ((match = sepRegex.exec(content)) !== null) {
      sepPositions.push({ start: match.index, end: match.index + match[0].length });
    }

    if (sepPositions.length >= 2) {
      isStructural = true;
      let lastEnd = 0;
      for (const sep of sepPositions) {
        const section = content.substring(lastEnd, sep.start).trim();
        if (section.length > 0) sections.push(section);
        lastEnd = sep.end;
      }
      const remaining = content.substring(sepPositions[sepPositions.length - 1].end).trim();
      if (remaining.length > 0) sections.push(remaining);
    }
  }

  // No structure detected — fall back to size-based chunking
  if (!isStructural) {
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
    return { chunks, isStructural: false };
  }

  // Post-processing: merge small sections (<200 chars) with the next one
  const MIN_SECTION_LENGTH = 200;
  const merged: string[] = [];
  let buffer = "";
  for (const section of sections) {
    if (buffer.length > 0) {
      buffer += "\n\n" + section;
    } else {
      buffer = section;
    }
    if (buffer.length >= MIN_SECTION_LENGTH) {
      merged.push(buffer);
      buffer = "";
    }
  }
  if (buffer.length > 0) {
    if (merged.length > 0) {
      merged[merged.length - 1] += "\n\n" + buffer;
    } else {
      merged.push(buffer);
    }
  }

  // Re-split any sections that still exceed maxChunkLength
  const result: string[] = [];
  for (const section of merged) {
    if (section.length > maxChunkLength) {
      let r = 0;
      while (r < section.length) {
        let end = Math.min(r + maxChunkLength, section.length);
        if (end < section.length) {
          const lastNewline = section.lastIndexOf('\n', end);
          if (lastNewline > r + maxChunkLength * 0.8) {
            end = lastNewline + 1;
          }
        }
        result.push(section.substring(r, end));
        r = end;
      }
    } else {
      result.push(section);
    }
  }

  return { chunks: result, isStructural: true };
}

const FIDELITY_INSTRUCTIONS = `
CONTENT FIDELITY INSTRUCTIONS (CRITICAL):
- You MUST preserve ALL code blocks, commands, SQL queries, and configuration snippets EXACTLY as they appear in the source. Include them in fenced code blocks with the appropriate language tag.
- You MUST preserve step-by-step procedures with ALL their numbered steps. Do NOT summarize "steps 1-5" into one sentence.
- You MUST preserve author attributions (e.g. "Auteur : X") when present.
- You MUST preserve ALL concrete examples, class names, method names, file paths, URLs, and configuration values.
- Do NOT summarize or paraphrase technical content. The wiki page must contain the SAME level of detail as the original source.
- Each wiki page should be COMPLETE and STANDALONE — a reader should NOT need to consult the original source file.
- IMPORTANT: When updating an EXISTING page (either via summaryPage or updates), provide ONLY the NEW content to be added. The system will automatically APPEND your output to the bottom of the existing page. Never try to rewrite the full existing content.
`;

// Ingest Files
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
        const fullGraph = await loadGraph();
        let documentContext = "";

        const ext = path.extname(file.originalname).toLowerCase();
        let prompt = "";
        let imagePayload: { base64: string; mimeType: string } | undefined = undefined;

        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          const fileBuffer = await fs.readFile(file.path);
          imagePayload = { base64: fileBuffer.toString("base64"), mimeType: `image/${ext.slice(1).replace('jpg', 'jpeg')}` };
          documentContext = file.originalname;
          const localGraphContext = getSubgraphForText(documentContext, fullGraph, 30);

          prompt = `I have a new image source named "${file.originalname}". 
      Please analyze this image, extract the knowledge or diagrams it contains.
      
      ${localGraphContext}
      
      Please:
      1. Create a summary page explaining this image.
      2. Identify key entities and concepts.
      3. Edit existing wiki pages, or create new ones, to weave this information into the wiki.
      4. Append \`\n\n---\n**Source:** [${file.originalname}](/raw/${file.safeName})\n\n![${file.originalname}](/raw/${file.safeName})\` to the bottom of the content of the summaryPage you create.
      CRITICAL GRAPH INSTRUCTION: You MUST interlink the pages! When typing markdown content, wrap entity/concept names in standard markdown links like [Text](existing_id). NEVER use double brackets [[text]]. ONLY link to IDs that actually exist in the LOCAL GRAPH NEIGHBORHOOD provided above or that you are actively creating. DO NOT hallucinate links.\n\nFormat your response as a JSON object exactly like this:
        {
          "summaryPage": { "id": "string", "content": "markdown" },
          "updates": [ { "id": "string", "content": "markdown" } ],
          "logEntry": "string (a 1-line description of what was ingested)"
        }\n\nDo your best to connect your new pages to the LOCAL GRAPH NEIGHBORHOOD nodes to build a cohesive map.`;

          const parsed = await callLLM(provider, prompt, WIKI_SYSTEM_PROMPT, true, imagePayload);
          await applyWikiUpdates([parsed.summaryPage, ...(parsed.updates || [])]);
          if (parsed.logEntry) await appendToLog(parsed.logEntry);
          const newPageIds = [parsed.summaryPage?.id, ...(parsed.updates || []).map((u: any) => u.id)].filter(Boolean);
          updatedPages.push(...newPageIds);
          fileUpdatedPages.push(...newPageIds);
          console.log(`${logPrefix} - Success. Generated summary: ${parsed.summaryPage?.id}`);

        } else {
          try {
            const content = await fs.readFile(file.path, "utf-8");
            const MAX_CHUNK_LENGTH = process.env.MAX_CHUNK_LENGTH ? parseInt(process.env.MAX_CHUNK_LENGTH) : 30000;

            const { chunks, isStructural } = splitIntoSections(content, MAX_CHUNK_LENGTH);

            console.log(`${logPrefix} - Split into ${chunks.length} ${isStructural ? 'sections' : 'chunks'}.`);

            let masterSummaryId = "";

            for (let part = 0; part < chunks.length; part++) {
              const chunkText = chunks[part];
              const label = isStructural ? "Section" : "Part";
              const chunkLogPrefix = chunks.length > 1 ? `${logPrefix} (${label} ${part + 1}/${chunks.length})` : logPrefix;

              console.log(`${chunkLogPrefix} - Processing...`);

              // Load graph freshly per-chunk so inter-chunk links exist!
              const currentGraph = await loadGraph();
              const localGraphContext = getSubgraphForText(chunkText.substring(0, 5000), currentGraph, 30);

              let chunkPrompt = `I have a source file named "${file.originalname}".\n`;

              if (chunks.length > 1) {
                if (isStructural) {
                  chunkPrompt += `This file contains ${chunks.length} distinct sections. You are processing SECTION ${part + 1} of ${chunks.length}.\n`;
                } else {
                  chunkPrompt += `This is PART ${part + 1} of ${chunks.length}.\n`;
                }
                if (part > 0) {
                  chunkPrompt += `\nCONTEXT: The main hub/summary page was created with ID "${masterSummaryId}". You must link to it and to concepts already created in previous sections.\n`;
                }
              }

              chunkPrompt += `Content:\n${chunkText}\n\n${localGraphContext}\n\nPlease:\n`;

              if (part === 0) {
                // First chunk/section always creates the hub page
                chunkPrompt += `1. Create a summary/hub page for this source. This hub page MUST end with a "## Sections" header to prepare for child TOC entries.\n`;
              } else if (isStructural) {
                // Structural mode: organize by topic
                chunkPrompt += `1. For the "summaryPage", identify the primary topic of this section. Check the LOCAL GRAPH NEIGHBORHOOD to see if a page for this topic already exists.\n   - If a relevant page exists, reuse its ID. Your new detailed content will be automatically appended to it.\n   - If no relevant page exists, invent a new descriptive standalone ID.\n`;
              } else {
                // Size-based mode: append to the master page
                chunkPrompt += `1. For the "summaryPage", use the exact id "${masterSummaryId}". Output ONLY the NEW information from this part, which the system will automatically append to the master summary page.\n`;
              }

              chunkPrompt += `2. Identify key entities and concepts.\n3. Edit existing wiki pages, or create new ones, to weave this information into the wiki.\n`;
              if (part > 0 && masterSummaryId) {
                chunkPrompt += `4. IMPORTANT: You MUST include an update for the hub page ("${masterSummaryId}") containing EXACTLY ONE list item (e.g. "- [Your Topic](your_id): description") to append to its Table of Contents. Do NOT include any headers in this update.\n`;
              }
              chunkPrompt += FIDELITY_INSTRUCTIONS;
              chunkPrompt += `CRITICAL GRAPH INSTRUCTION: You MUST interlink the pages! When typing markdown content, wrap entity/concept names in standard markdown links like [Text](existing_id). NEVER use double brackets [[text]]. ONLY link to IDs that actually exist in the LOCAL GRAPH NEIGHBORHOOD provided above or that you are actively creating. DO NOT hallucinate links.\n\nFormat your response as a JSON object exactly like this:
        {
          "summaryPage": { "id": "string", "content": "markdown" },
          "updates": [ { "id": "string", "content": "markdown" } ],
          "logEntry": "string (a 1-line description of what was ingested)"
        }\n\nDo your best to connect your new pages to the LOCAL GRAPH NEIGHBORHOOD nodes to build a cohesive map.`;

              const parsed = await callLLM(provider, chunkPrompt, WIKI_SYSTEM_PROMPT, true);

              if (part === 0 && parsed.summaryPage?.id) {
                masterSummaryId = parsed.summaryPage.id;
              }

              await applyWikiUpdates([parsed.summaryPage, ...(parsed.updates || [])]);
              const chunkPageIds = [parsed.summaryPage?.id, ...(parsed.updates || []).map((u: any) => u.id)].filter(Boolean);
              updatedPages.push(...chunkPageIds);
              fileUpdatedPages.push(...chunkPageIds);

              if (parsed.logEntry) await appendToLog(parsed.logEntry);

              console.log(`${chunkLogPrefix} - Success.`);
            }
          } catch (readErr: any) {
            console.error(`${logPrefix} - FAILED reading "${file.originalname}" as text: ${readErr.message}`);
            continue;
          }
        }
        
        // Programmatic Provenance: Append source to all pages touched by this file
        try {
          const uniquePagesForFile = [...new Set(fileUpdatedPages)];
          const sourceBlock = `\n\n---\n**Source:** [${file.originalname}](/raw/${file.safeName})`;
          for (const pageId of uniquePagesForFile) {
            if (pageId === "index" || pageId === "log") continue;
            const pagePath = path.join(WIKI_DIR, `${pageId}.md`);
            try {
              const content = await fs.readFile(pagePath, "utf-8");
              if (!content.includes(`**Source:** [${file.originalname}]`)) {
                await fs.writeFile(pagePath, content + sourceBlock, "utf-8");
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
