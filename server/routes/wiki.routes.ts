import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { WIKI_DIR } from "../config";
import { buildGraphFull } from "../services/graph.service";
import { getClustersForPage } from "../services/cluster.service";

export const wikiRouter = Router();

// List all wiki pages
wikiRouter.get("/", async (req, res) => {
  try {
    const files = await fs.readdir(WIKI_DIR);
    const pages = files.filter(f => f.endsWith(".md")).map(f => f.replace(".md", ""));
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: "Failed to list wiki pages" });
  }
});

// Get a wiki page (enriched with clusters)
wikiRouter.get("/:id", async (req, res) => {
  try {
    const filePath = path.join(WIKI_DIR, `${req.params.id}.md`);
    const content = await fs.readFile(filePath, "utf-8");
    const clusters = await getClustersForPage(req.params.id);
    res.json({ id: req.params.id, content, clusters });
  } catch (err) {
    res.status(404).json({ error: "Page not found" });
  }
});

// Save/Update a wiki page directly
wikiRouter.post("/:id", async (req, res) => {
  try {
    const filePath = path.join(WIKI_DIR, `${req.params.id}.md`);
    await fs.writeFile(filePath, req.body.content, "utf-8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save page" });
  }
});

// Delete a wiki page
wikiRouter.delete("/:id", async (req, res) => {
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

export const searchRouter = Router();

// Search wiki pages
searchRouter.get("/", async (req, res) => {
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
