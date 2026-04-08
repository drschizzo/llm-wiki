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
      4. Append \`\n\n---\n**Source:** [${file.originalname}](/raw/${file.safeName})\` to the bottom of the content of the summaryPage you create.
      CRITICAL GRAPH INSTRUCTION: You MUST interlink the pages! When typing markdown content, wrap entity/concept names in standard markdown links like [Text](existing_id). NEVER use double brackets [[text]]. ONLY link to IDs that actually exist in the LOCAL GRAPH NEIGHBORHOOD provided above or that you are actively creating. DO NOT hallucinate links.\n\nFormat your response as a JSON object exactly like this:
        {
          "summaryPage": { "id": "string", "content": "markdown" },
          "updates": [ { "id": "string", "content": "markdown" } ],
          "logEntry": "string (a 1-line description of what was ingested)"
        }\n\nDo your best to connect your new pages to the LOCAL GRAPH NEIGHBORHOOD nodes to build a cohesive map.`;

          const parsed = await callLLM(provider, prompt, WIKI_SYSTEM_PROMPT, true, imagePayload);
          await applyWikiUpdates([parsed.summaryPage, ...(parsed.updates || [])]);
          if (parsed.logEntry) await appendToLog(parsed.logEntry);
          updatedPages.push(parsed.summaryPage?.id, ...(parsed.updates || []).map((u: any) => u.id));
          console.log(`${logPrefix} - Success. Generated summary: ${parsed.summaryPage?.id}`);

        } else {
          try {
            const content = await fs.readFile(file.path, "utf-8");
            const MAX_CHUNK_LENGTH = process.env.MAX_CHUNK_LENGTH ? parseInt(process.env.MAX_CHUNK_LENGTH) : 30000;

            let chunks: string[] = [];
            let r = 0;
            while (r < content.length) {
              let end = Math.min(r + MAX_CHUNK_LENGTH, content.length);
              if (end < content.length) {
                const lastNewline = content.lastIndexOf('\n', end);
                if (lastNewline > r + MAX_CHUNK_LENGTH * 0.8) {
                  end = lastNewline + 1;
                }
              }
              chunks.push(content.substring(r, end));
              r = end;
            }

            let masterSummaryId = "";

            for (let part = 0; part < chunks.length; part++) {
              const chunkText = chunks[part];
              const chunkLogPrefix = chunks.length > 1 ? `${logPrefix} (Part ${part + 1}/${chunks.length})` : logPrefix;

              console.log(`${chunkLogPrefix} - Processing chunk...`);

              // Load graph freshly per-chunk so inter-chunk links exist!
              const currentGraph = await loadGraph();
              const localGraphContext = getSubgraphForText(chunkText.substring(0, 5000), currentGraph, 30);

              let chunkPrompt = `I have a source file named "${file.originalname}".\n`;
              if (chunks.length > 1) {
                chunkPrompt += `This is PART ${part + 1} of ${chunks.length}.\n`;
                if (part > 0) chunkPrompt += `\nCRITICAL CONTEXT: In previous parts, you established the main summary page under the ID "${masterSummaryId}". You must continue to link to the concepts you already created.\n`;
              }

              chunkPrompt += `Content:\n${chunkText}\n\n${localGraphContext}\n\nPlease:\n`;

              if (part === 0) {
                chunkPrompt += `1. Create a summary page for this source. Append \`\n\n---\n**Source:** [${file.originalname}](/raw/${file.safeName})\` to the bottom of its content.\n`;
              } else {
                chunkPrompt += `1. For the "summaryPage" property, DO NOT output a brand new page. Output ONLY the NEW information from this part, which the system will automatically append to the master summary page "${masterSummaryId}". Use the id "${masterSummaryId}".\n`;
              }

              chunkPrompt += `2. Identify key entities and concepts.\n3. Edit existing wiki pages, or create new ones, to weave this information into the wiki.
      CRITICAL GRAPH INSTRUCTION: You MUST interlink the pages! When typing markdown content, wrap entity/concept names in standard markdown links like [Text](existing_id). NEVER use double brackets [[text]]. ONLY link to IDs that actually exist in the LOCAL GRAPH NEIGHBORHOOD provided above or that you are actively creating. DO NOT hallucinate links.\n\nFormat your response as a JSON object exactly like this:
        {
          "summaryPage": { "id": "string", "content": "markdown" },
          "updates": [ { "id": "string", "content": "markdown" } ],
          "logEntry": "string (a 1-line description of what was ingested)"
        }\n\nDo your best to connect your new pages to the LOCAL GRAPH NEIGHBORHOOD nodes to build a cohesive map.`;

              const parsed = await callLLM(provider, chunkPrompt, WIKI_SYSTEM_PROMPT, true);

              if (part === 0 && parsed.summaryPage?.id) {
                masterSummaryId = parsed.summaryPage.id;
                await applyWikiUpdates([parsed.summaryPage, ...(parsed.updates || [])]);
                updatedPages.push(masterSummaryId);
              } else if (part > 0 && masterSummaryId) {
                if (parsed.summaryPage?.content) {
                  const masterPath = path.join(WIKI_DIR, `${masterSummaryId}.md`);
                  try {
                    let existing = await fs.readFile(masterPath, "utf-8");
                    existing += `\n\n${parsed.summaryPage.content}`;
                    await fs.writeFile(masterPath, existing, "utf-8");
                  } catch (e) { }
                }
                await applyWikiUpdates(parsed.updates || []);
              } else {
                await applyWikiUpdates([parsed.summaryPage, ...(parsed.updates || [])]);
              }

              if (parsed.logEntry) await appendToLog(parsed.logEntry);
              updatedPages.push(...(parsed.updates || []).map((u: any) => u.id));

              console.log(`${chunkLogPrefix} - Success.`);
            }
          } catch (readErr: any) {
            console.error(`${logPrefix} - FAILED reading "${file.originalname}" as text: ${readErr.message}`);
            continue;
          }
        }

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
