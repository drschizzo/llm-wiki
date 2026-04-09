import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { WIKI_DIR } from "../config";
import { buildGraphFull } from "../services/graph.service";
import { mergePages, splitPage, SplitSection } from "../services/wiki.service";

export const adminRouter = Router();

// Clean dead links from graph
adminRouter.post("/clean-links", async (req, res) => {
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

// Merge two pages: source is merged INTO target, source is deleted
adminRouter.post("/merge", async (req, res) => {
  const { targetId, sourceId } = req.body;

  if (!targetId || !sourceId) {
    return res.status(400).json({ error: "Both targetId and sourceId are required" });
  }

  try {
    const result = await mergePages(targetId, sourceId);
    if (!result.success) {
      return res.status(404).json({ error: "One or both pages not found, or invalid IDs" });
    }
    res.json({ success: true, rewrittenLinks: result.rewrittenLinks });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to merge pages", details: err.message });
  }
});

// Split a page into multiple sub-pages
adminRouter.post("/split", async (req, res) => {
  const { pageId, sections } = req.body as { pageId: string; sections: SplitSection[] };

  if (!pageId || !sections || !Array.isArray(sections) || sections.length < 2) {
    return res.status(400).json({ error: "pageId and at least 2 sections are required" });
  }

  // Validate sections
  for (const section of sections) {
    if (!section.id || !section.title || !section.content) {
      return res.status(400).json({ error: "Each section must have id, title, and content" });
    }
  }

  try {
    const result = await splitPage(pageId, sections);
    if (!result.success) {
      return res.status(404).json({ error: "Page not found or invalid ID" });
    }
    res.json({ success: true, createdPages: result.createdPages });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to split page", details: err.message });
  }
});
