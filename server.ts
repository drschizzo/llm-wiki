import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs/promises";
import multer from "multer";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import AdmZip from "adm-zip";
import crypto from "crypto";

const app = express();
const PORT = 3000;

// Storage paths
const DATA_DIR = path.join(process.cwd(), "data");
const RAW_DIR = path.join(DATA_DIR, "raw");
const WIKI_DIR = path.join(DATA_DIR, "wiki");

// Ensure directories exist
async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(WIKI_DIR, { recursive: true });

  const indexFile = path.join(WIKI_DIR, "index.md");
  const logFile = path.join(WIKI_DIR, "log.md");

  try { await fs.access(indexFile); } catch { await fs.writeFile(indexFile, "# Wiki Index\n\nWelcome to your LLM Wiki."); }
  try { await fs.access(logFile); } catch { await fs.writeFile(logFile, "# Activity Log\n\n- [2026-04-04] Wiki initialized."); }
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ dest: RAW_DIR });

const WIKI_SYSTEM_PROMPT = "You are a disciplined Wiki maintainer. You extract knowledge and create a CONNECTED KNOWLEDGE GRAPH. CRITICAL: Whenever you mention a concept, entity, or topic in your markdown content that exists in the local knowledge graph, you MUST create a standard markdown link to it using EXACTLY the syntax: `[Text to display](id_from_graph)`. Example: `[Linear Regression](machine-learning-regression)`. DO NOT use double brackets like `[[id]]` or `[[id|text]]`. DO NOT link to any concept or ID that does not exist in the PROVIDED GRAPH, unless you are creating it in the 'updates' array. Never create isolated islands of information.";

const PROCESSED_FILES_DB = path.join(DATA_DIR, "processed_hashes.json");

async function loadProcessedHashes(): Promise<string[]> {
  try {
    const data = await fs.readFile(PROCESSED_FILES_DB, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveProcessedHash(hash: string) {
  const hashes = await loadProcessedHashes();
  if (!hashes.includes(hash)) {
    hashes.push(hash);
    await fs.writeFile(PROCESSED_FILES_DB, JSON.stringify(hashes), "utf-8");
  }
}

async function getFileHash(filePath: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

async function callLLM(
  provider: string,
  prompt: string,
  systemInstruction: string,
  jsonMode: boolean = false,
  imagePayload?: { base64: string; mimeType: string }
) {
  let text = "";
  console.log("Calling LLM with provider", provider);
  if (provider === "gemini") {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    let contents: any = prompt;
    if (imagePayload) {
      contents = [
        prompt,
        { inlineData: { data: imagePayload.base64, mimeType: imagePayload.mimeType } }
      ];
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: contents,
      config: {
        systemInstruction,
        responseMimeType: jsonMode ? "application/json" : "text/plain"
      }
    });
    text = response.text || "";
  } else if (provider === "lmstudio") {
    let systemContent = systemInstruction;
    if (jsonMode) {
      systemContent += "\n\nCRITICAL: You must respond with ONLY strictly valid JSON. Use double quotes for all keys and strings. Do not use trailing commas.";
    }
    const messages: any[] = [
      { role: "system", content: systemContent }
    ];
    if (imagePayload) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${imagePayload.mimeType};base64,${imagePayload.base64}` } }
        ]
      });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const apiUrl = process.env.LMSTUDIO_API_URL || "http://127.0.0.1:1234/v1/chat/completions";
    const modelName = process.env.LOCAL_MODEL_NAME || "local-model";
    
    const payload: any = {
      model: modelName,
      messages,
      temperature: 0.7
    };
    if (jsonMode) {
      payload.response_format = { type: "json_object" };
    }
    
    const response = await axios.post(apiUrl, payload);
    text = response.data.choices[0].message.content;
  }

  if (jsonMode) {
    const jsonStr = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] || text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1) || text;
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      const debugFile = path.join(DATA_DIR, `failed_json_${Date.now()}.txt`);
      try { await fs.writeFile(debugFile, jsonStr, "utf-8"); } catch (err) { }
      console.error(`Failed to parse JSON. Raw output saved to ${debugFile}`);
      throw new Error(`Invalid JSON response from LLM. Raw text saved to ${debugFile}`);
    }
  }
  return text;
}

interface GraphNode {
  id: string;
  title: string;
}

interface WikiGraph {
  nodes: Record<string, GraphNode>;
  edges: Record<string, string[]>;
}

const GRAPH_DB_FILE = path.join(DATA_DIR, "graph.json");

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9àâäéèêëïîôöùûüÿç]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

async function buildGraphFull(): Promise<WikiGraph> {
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

async function loadGraph(): Promise<WikiGraph> {
  try {
    const data = await fs.readFile(GRAPH_DB_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return await buildGraphFull();
  }
}

function getSubgraphForText(text: string, graph: WikiGraph, maxNodes: number = 30): string {
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

async function applyWikiUpdates(updates: any[]) {
  if (!updates || !Array.isArray(updates)) return;
  for (const update of updates) {
    if (!update.id || !update.content) continue;
    const filePath = path.join(WIKI_DIR, `${update.id}.md`);
    await fs.writeFile(filePath, update.content, "utf-8");
  }
  await buildGraphFull();
}

async function appendToLog(logEntry: string) {
  if (!logEntry) return;
  const logFile = path.join(WIKI_DIR, "log.md");
  const dateStr = new Date().toISOString().split('T')[0];
  const entry = `\n- [${dateStr}] ${logEntry}`;
  try {
    await fs.appendFile(logFile, entry, "utf-8");
  } catch (err) {
    console.error("Failed to append to log", err);
  }
}

// --- API ROUTES ---

// Clean dead links from graph
app.post("/api/admin/clean-links", async (req, res) => {
  try {
    const files = await fs.readdir(WIKI_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    const validIds = new Set(mdFiles.map(f => f.replace('.md', '')));

    let totalModifiedFiles = 0;
    let totalRemovedLinks = 0;

    for (const file of mdFiles) {
      if (file === 'index.md' || file === 'log.md') continue;

      const filePath = path.join(WIKI_DIR, file);
      const content = await fs.readFile(filePath, "utf-8");

      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let fileModified = false;
      let localRemovedLinks = 0;

      const newContent = content.replace(linkRegex, (match, label, target) => {
        let cleanTarget = target.trim();
        if (cleanTarget.endsWith('.md')) cleanTarget = cleanTarget.slice(0, -3);

        if (cleanTarget.startsWith('http') || cleanTarget.startsWith('#')) return match;

        if (!validIds.has(cleanTarget)) {
          fileModified = true;
          localRemovedLinks++;
          return label; // strip link formatting
        }
        return match;
      });

      if (fileModified) {
        await fs.writeFile(filePath, newContent, "utf-8");
        totalModifiedFiles++;
        totalRemovedLinks += localRemovedLinks;
      }
    }

    // Hard refresh graph to prune dead edges
    await buildGraphFull();

    res.json({ success: true, modifiedFiles: totalModifiedFiles, removedLinks: totalRemovedLinks });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to clean links", details: err.message });
  }
});

// Get whole visual graph
app.get("/api/graph", async (req, res) => {
  try {
    const graph = await loadGraph();
    const formattedNodes = Object.values(graph.nodes).map(n => ({ id: n.id, name: n.title }));

    const formattedLinks: { source: string, target: string }[] = [];
    for (const [source, targets] of Object.entries(graph.edges)) {
      for (const target of targets) {
        if (graph.nodes[target]) {
          formattedLinks.push({ source, target });
        }
      }
    }

    res.json({ nodes: formattedNodes, links: formattedLinks });
  } catch (err) {
    res.status(500).json({ error: "Failed to load graph" });
  }
});

// List all wiki pages
app.get("/api/wiki", async (req, res) => {
  try {
    const files = await fs.readdir(WIKI_DIR);
    const pages = files.filter(f => f.endsWith(".md")).map(f => f.replace(".md", ""));
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: "Failed to list wiki pages" });
  }
});

// Get a wiki page
app.get("/api/wiki/:id", async (req, res) => {
  try {
    const filePath = path.join(WIKI_DIR, `${req.params.id}.md`);
    const content = await fs.readFile(filePath, "utf-8");
    res.json({ id: req.params.id, content });
  } catch (err) {
    res.status(404).json({ error: "Page not found" });
  }
});

// Save/Update a wiki page directly
app.post("/api/wiki/:id", async (req, res) => {
  try {
    const filePath = path.join(WIKI_DIR, `${req.params.id}.md`);
    await fs.writeFile(filePath, req.body.content, "utf-8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save page" });
  }
});

// Delete a wiki page
app.delete("/api/wiki/:id", async (req, res) => {
  try {
    const filePath = path.join(WIKI_DIR, `${req.params.id}.md`);
    
    // Check if file exists, if so delete it
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
    } catch {
      return res.status(404).json({ error: "Page not found" });
    }
    
    // Rebuild the graph to reflect the deletion
    await buildGraphFull();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete page" });
  }
});

// Search wiki pages
app.get("/api/search", async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.json([]);

  try {
    const files = await fs.readdir(WIKI_DIR);
    const results = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await fs.readFile(path.join(WIKI_DIR, file), "utf-8");
      if (content.toLowerCase().includes(query.toLowerCase())) {
        results.push({ id: file.replace(".md", ""), snippet: content.substring(0, 200) + "..." });
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Search failed" });
  }
});

// Ingest URL
app.post("/api/ingest/url", async (req, res) => {
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
    
    Ensure that one of the items in "updates" has the id "index" containing the full updated content of index.md.`;

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
app.post("/api/ingest/files", upload.array("files"), async (req, res) => {
  const uploadedFiles = req.files as Express.Multer.File[];
  const provider = req.body.provider || "gemini";

  try {
    const updatedPages: string[] = [];
    let filesToProcess: { path: string, originalname: string, mtimeMs: number }[] = [];

    for (const file of uploadedFiles) {
      if (file.originalname.toLowerCase().endsWith('.zip')) {
        const zipPath = file.path;
        const extractPath = path.join(DATA_DIR, "tmp_unzip", `${Date.now()}`);
        await fs.mkdir(extractPath, { recursive: true });

        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractPath, true);

        const unzippedFiles = await processFilesRecursive(extractPath);
        for (const uf of unzippedFiles) {
          const stat = await fs.stat(uf);
          filesToProcess.push({ path: uf, originalname: path.basename(uf), mtimeMs: stat.mtimeMs });
        }
      } else {
        const stat = await fs.stat(file.path);
        filesToProcess.push({ path: file.path, originalname: file.originalname, mtimeMs: stat.mtimeMs });
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
                chunkPrompt += `1. Create a summary page for this source.\n`;
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

// Chat with Assistant
app.post("/api/chat", async (req, res) => {
  const { history, provider = "gemini" } = req.body;

  const lastUserMessage = history.length > 0 ? history[history.length - 1].content : "";
  const fullGraph = await loadGraph();
  const localGraphContext = getSubgraphForText(lastUserMessage, fullGraph, 40);

  const systemPrompt = `You are a highly autonomous AI Wiki Assistant. You manage the user's personal knowledge base.
You have access to the Local Graph Neighborhood (nodes relevant to the user's prompt):
---
${localGraphContext}
---

Before answering, you can explore the wiki deeply using two actions:
1. "exploreGraph": ["id"] -> To get the neighbors (links to and from) a specific node.
2. "readPages": ["id"] -> To read the full text content of a node.

If you don't need any more context, formulate your reply in "responseMessage".

CRITICAL INSTRUCTIONS FOR AUTONOMY & CONNECTIVITY:
1. NEVER ask for permission to update or create wiki pages. If the conversation contains new, valuable information, concepts, or corrections, you MUST update the wiki IMMEDIATELY by populating the "wikiUpdates" array.
2. DO NOT say "I will analyze this" or "I'm reading" or "Let me check". Work silently.
3. ISOLATED PAGES ARE PROHIBITED. If you create a NEW page, you MUST simultaneously update at least one EXISTING page (check the Local Graph Neighborhood) in the "wikiUpdates" array to add a link pointing to your newly created page. Conversely, your new page MUST link to existing pages. Use standard markdown links!

Format your response as a JSON object exactly like this:
{
  "exploreGraph": ["page_id_1"],
  "readPages": ["page_id_1", "page_id_2"],
  "responseMessage": "Your final reply to the user... (leave empty if you are exploring or reading)",
  "wikiUpdates": [
    { "id": "page_id_to_create_or_update", "content": "full markdown content..." }
  ],
  "logEntry": "1-line summary of what you changed (only if you made updates)"
}

If no updates are needed, leave "wikiUpdates" as an empty array [] and omit "logEntry".`;

  let currentPrompt = history.map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n') + '\n\nAssistant:';

  try {
    let loopCount = 0;
    const MAX_LOOPS = 4;
    let lastParsed: any = null;
    let allWikiUpdates: any[] = [];
    let updatedPagesTracker = new Set<string>();
    let generatedLogEntry = "";

    while (loopCount < MAX_LOOPS) {
      loopCount++;
      const parsed = await callLLM(provider, currentPrompt, systemPrompt, true);
      lastParsed = parsed;

      const requestedPages = parsed.readPages || [];
      const requestedExplore = parsed.exploreGraph || [];

      if (parsed.logEntry) {
        generatedLogEntry = parsed.logEntry;
      }

      if (parsed.wikiUpdates && parsed.wikiUpdates.length > 0) {
        for (const update of parsed.wikiUpdates) {
          const existingIdx = allWikiUpdates.findIndex(u => u.id === update.id);
          if (existingIdx >= 0) allWikiUpdates[existingIdx] = update;
          else allWikiUpdates.push(update);
          updatedPagesTracker.add(update.id);
        }
      }

      // Continue looping if tools are requested, regardless of responseMessage
      if (requestedPages.length > 0 || requestedExplore.length > 0) {
        let extraContext = "\n\n[System: Action Results:]\n";

        if (requestedExplore.length > 0) {
          for (const id of requestedExplore) {
            // Using getSubgraphForText on the ID text essentially pulls its direct neighbors
            const nodeSubgraph = getSubgraphForText(id + " " + (fullGraph.nodes[id]?.title || ""), fullGraph, 20);
            extraContext += `\n--- GRAPH EXPLORATION: ${id} ---\n${nodeSubgraph}\n`;
          }
        }

        if (requestedPages.length > 0) {
          for (const pageId of requestedPages) {
            const content = await fs.readFile(path.join(WIKI_DIR, `${pageId}.md`), "utf-8").catch(() => null);
            if (content) {
              extraContext += `\n--- PAGE: ${pageId} ---\n${content}\n`;
            } else {
              extraContext += `\n--- PAGE: ${pageId} ---\n(Page does not exist)\n`;
            }
          }
        }

        if (parsed.responseMessage && parsed.responseMessage.trim() !== "") {
          extraContext += `\n(You also formulated an internal thought: "${parsed.responseMessage}")\n`;
        }

        extraContext += "\nNow provide your final \"responseMessage\" and any additional \"wikiUpdates\". If you STILL need to read more pages or explore more nodes, you may leave responseMessage empty and populate the arrays again.\nAssistant:";
        currentPrompt += extraContext;
      } else {
        break; // No more tools requested, generation is final
      }
    }

    if (allWikiUpdates.length > 0) {
      await applyWikiUpdates(allWikiUpdates);
      
      const pageList = Array.from(updatedPagesTracker).join(", ");
      let logMsg = generatedLogEntry ? `${generatedLogEntry} (Pages: ${pageList})` : `Agent updated pages: ${pageList}`;
      await appendToLog(logMsg);
    }

    res.json({
      text: lastParsed?.responseMessage || "I have finished processing your request.",
      updatedPages: Array.from(updatedPagesTracker)
    });
  } catch (err: any) {
    console.log(err);
    res.status(500).json({ error: "Chat failed", details: err.message });
  }
});

// --- VITE MIDDLEWARE ---
async function startServer() {
  await ensureDirs();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
