import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { WIKI_DIR, RAW_DIR } from "../config";
import { callLLM } from "../services/llm.service";
import { loadGraph, getSubgraphForText } from "../services/graph.service";
import { applyWikiUpdates, appendToLog } from "../services/wiki.service";

export const chatRouter = Router();

// Chat with Assistant
chatRouter.post("/", async (req, res) => {
  const { history, provider = "gemini" } = req.body;

  const lastUserMessage = history.length > 0 ? history[history.length - 1].content : "";
  const fullGraph = await loadGraph();
  const localGraphContext = getSubgraphForText(lastUserMessage, fullGraph, 40);
  const chatId = `chat-${Date.now()}`;

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
4. IMPORTANT Source Tracking: For ANY new page you create, you MUST append \`\n\n---\n**Source:** [Conversation Transcript](/raw/${chatId}.md)\` to the bottom of the page content.

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

  // Save the conversation to RAW_DIR as a transcript source
  try {
    const transcriptContent = history.map((msg: any) => `**${msg.role === 'user' ? 'User' : 'Assistant'}:**\n${msg.content}`).join('\n\n');
    const transcriptPath = path.join(RAW_DIR, `${chatId}.md`);
    await fs.writeFile(transcriptPath, transcriptContent, "utf-8");
  } catch (err) {
    console.error("Failed to save conversation transcript source:", err);
  }

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
