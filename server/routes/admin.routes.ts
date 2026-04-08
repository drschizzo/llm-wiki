import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { WIKI_DIR } from "../config";
import { buildGraphFull } from "../services/graph.service";

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
