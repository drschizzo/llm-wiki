import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { DATA_DIR, WIKI_DIR } from "../config";
import { buildGraphFull, loadGraph } from "./graph.service";

const PROCESSED_FILES_DB = path.join(DATA_DIR, "processed_hashes.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

// --- Processed Hashes ---

export async function loadProcessedHashes(): Promise<string[]> {
  try {
    const data = await fs.readFile(PROCESSED_FILES_DB, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function saveProcessedHash(hash: string) {
  const hashes = await loadProcessedHashes();
  if (!hashes.includes(hash)) {
    hashes.push(hash);
    await fs.writeFile(PROCESSED_FILES_DB, JSON.stringify(hashes), "utf-8");
  }
}

export async function getFileHash(filePath: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

// --- Backup System ---

async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

/**
 * Creates a timestamped backup of a wiki page before destructive operations.
 * Backups are stored in data/backups/{pageId}_{timestamp}.md
 */
async function backupPage(pageId: string): Promise<string | null> {
  const pagePath = path.join(WIKI_DIR, `${pageId}.md`);
  try {
    const content = await fs.readFile(pagePath, "utf-8");
    await ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `${pageId}_${timestamp}.md`;
    const backupPath = path.join(BACKUP_DIR, backupFileName);
    await fs.writeFile(backupPath, content, "utf-8");
    console.log(`[Backup] Saved backup: ${backupFileName}`);
    return backupPath;
  } catch {
    // Page doesn't exist, nothing to backup
    return null;
  }
}

// --- Wiki Update Operations ---

export interface WikiUpdate {
  id: string;
  content: string;
  mode?: "append" | "replace";
}

export async function applyWikiUpdates(updates: WikiUpdate[]) {
  if (!updates || !Array.isArray(updates)) return;
  for (const update of updates) {
    if (!update.id || !update.content) continue;
    if (update.id === 'index' || update.id === 'log') continue; // Auto-generated/system pages
    const filePath = path.join(WIKI_DIR, `${update.id}.md`);

    if (update.mode === "replace") {
      // Backup before replacing
      await backupPage(update.id);
      await fs.writeFile(filePath, update.content, "utf-8");
      console.log(`[Wiki] Replaced page: ${update.id}`);
    } else {
      // Default: append mode (existing behavior)
      try {
        const existing = await fs.readFile(filePath, "utf-8");

        // Smart formatting: if appending a list item, use single new line to keep lists compact
        const isListItem = /^\s*[-*]\s+/.test(update.content);
        const appendStr = isListItem ? `\n${update.content}` : `\n\n${update.content}`;

        await fs.writeFile(filePath, existing + appendStr, "utf-8");
      } catch {
        await fs.writeFile(filePath, update.content, "utf-8");
      }
    }
  }
  await buildGraphFull();
}

// --- Delete Page ---

/**
 * Deletes a wiki page and cleans up all dead links across the wiki.
 * Creates a backup before deletion.
 * Returns the count of links that were cleaned.
 */
export async function deletePage(pageId: string): Promise<{ success: boolean; removedLinks: number }> {
  if (pageId === 'index' || pageId === 'log') {
    return { success: false, removedLinks: 0 };
  }

  const pagePath = path.join(WIKI_DIR, `${pageId}.md`);

  // Check page exists
  try {
    await fs.access(pagePath);
  } catch {
    return { success: false, removedLinks: 0 };
  }

  // Backup before deletion
  await backupPage(pageId);

  // Delete the page
  await fs.unlink(pagePath);
  console.log(`[Wiki] Deleted page: ${pageId}`);

  // Clean up dead links in all remaining pages
  const removedLinks = await cleanDeadLinksForId(pageId);

  // Rebuild graph
  await buildGraphFull();

  return { success: true, removedLinks };
}

/**
 * Scans all wiki pages and removes links pointing to a specific (deleted) pageId.
 * The link text is preserved, only the link formatting is stripped.
 */
async function cleanDeadLinksForId(deadId: string): Promise<number> {
  const files = await fs.readdir(WIKI_DIR).catch(() => []);
  let totalRemoved = 0;

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    if (file === 'index.md' || file === 'log.md') continue;

    const filePath = path.join(WIKI_DIR, file);
    const content = await fs.readFile(filePath, "utf-8");

    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let modified = false;
    let localRemoved = 0;

    const newContent = content.replace(linkRegex, (match, label, target) => {
      let cleanTarget = target.trim();
      if (cleanTarget.endsWith('.md')) cleanTarget = cleanTarget.slice(0, -3);
      if (cleanTarget.startsWith('http') || cleanTarget.startsWith('#') || cleanTarget.startsWith('/')) return match;

      if (cleanTarget === deadId) {
        modified = true;
        localRemoved++;
        return label; // Strip link formatting, keep text
      }
      return match;
    });

    if (modified) {
      await fs.writeFile(filePath, newContent, "utf-8");
      totalRemoved += localRemoved;
    }
  }

  return totalRemoved;
}

// --- Merge Pages ---

/**
 * Merges sourceId page INTO targetId page.
 * 1. Backs up both pages
 * 2. Appends source content to target
 * 3. Rewrites all links pointing to sourceId → targetId across the wiki
 * 4. Deletes the source page
 * 5. Rebuilds the graph
 */
export async function mergePages(targetId: string, sourceId: string): Promise<{ success: boolean; rewrittenLinks: number }> {
  if (targetId === sourceId) return { success: false, rewrittenLinks: 0 };
  if (['index', 'log'].includes(targetId) || ['index', 'log'].includes(sourceId)) {
    return { success: false, rewrittenLinks: 0 };
  }

  const targetPath = path.join(WIKI_DIR, `${targetId}.md`);
  const sourcePath = path.join(WIKI_DIR, `${sourceId}.md`);

  // Check both pages exist
  try {
    await fs.access(targetPath);
    await fs.access(sourcePath);
  } catch {
    return { success: false, rewrittenLinks: 0 };
  }

  // Backup both pages
  await backupPage(targetId);
  await backupPage(sourceId);

  // Read both
  const targetContent = await fs.readFile(targetPath, "utf-8");
  const sourceContent = await fs.readFile(sourcePath, "utf-8");

  // Merge: append source content to target with a separator
  const mergedContent = targetContent + `\n\n---\n*Merged from: ${sourceId}*\n\n` + sourceContent;
  await fs.writeFile(targetPath, mergedContent, "utf-8");
  console.log(`[Wiki] Merged "${sourceId}" into "${targetId}"`);

  // Rewrite all links pointing to sourceId → targetId across all pages
  const rewrittenLinks = await rewriteLinksAcrossWiki(sourceId, targetId);

  // Delete the source page (no need to backup again, already done)
  await fs.unlink(sourcePath);

  // Rebuild graph
  await buildGraphFull();

  return { success: true, rewrittenLinks };
}

/**
 * Rewrites all markdown links across the wiki: [text](oldId) → [text](newId)
 */
async function rewriteLinksAcrossWiki(oldId: string, newId: string): Promise<number> {
  const files = await fs.readdir(WIKI_DIR).catch(() => []);
  let totalRewritten = 0;

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    if (file === 'index.md' || file === 'log.md') continue;

    const filePath = path.join(WIKI_DIR, file);
    const content = await fs.readFile(filePath, "utf-8");

    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let modified = false;
    let localRewritten = 0;

    const newContent = content.replace(linkRegex, (match, label, target) => {
      let cleanTarget = target.trim();
      if (cleanTarget.endsWith('.md')) cleanTarget = cleanTarget.slice(0, -3);
      if (cleanTarget.startsWith('http') || cleanTarget.startsWith('#') || cleanTarget.startsWith('/')) return match;

      if (cleanTarget === oldId) {
        modified = true;
        localRewritten++;
        return `[${label}](${newId})`;
      }
      return match;
    });

    if (modified) {
      await fs.writeFile(filePath, newContent, "utf-8");
      totalRewritten += localRewritten;
    }
  }

  return totalRewritten;
}

// --- Split Page ---

export interface SplitSection {
  id: string;
  title: string;
  content: string;
}

/**
 * Splits a page into multiple sub-pages and converts the original into a hub/TOC page.
 * 1. Backs up the original page
 * 2. Creates each sub-page
 * 3. Rewrites links to the original → the most relevant sub-page (or keeps hub)
 * 4. Replaces the original page with a hub that links to all sub-pages
 * 5. Rebuilds the graph
 */
export async function splitPage(pageId: string, sections: SplitSection[]): Promise<{ success: boolean; createdPages: string[] }> {
  if (['index', 'log'].includes(pageId)) {
    return { success: false, createdPages: [] };
  }
  if (!sections || sections.length < 2) {
    return { success: false, createdPages: [] };
  }

  const pagePath = path.join(WIKI_DIR, `${pageId}.md`);

  // Check page exists
  try {
    await fs.access(pagePath);
  } catch {
    return { success: false, createdPages: [] };
  }

  // Backup original
  await backupPage(pageId);

  // Read original to extract the title
  const originalContent = await fs.readFile(pagePath, "utf-8");
  const titleMatch = originalContent.match(/^#\s+(.+)$/m);
  const originalTitle = titleMatch ? titleMatch[1].trim() : pageId;

  // Create each sub-page
  const createdPages: string[] = [];
  for (const section of sections) {
    const sectionPath = path.join(WIKI_DIR, `${section.id}.md`);
    // Add a back-link to the hub page
    const sectionContent = `# ${section.title}\n\n*Part of: [${originalTitle}](${pageId})*\n\n${section.content}`;
    await fs.writeFile(sectionPath, sectionContent, "utf-8");
    createdPages.push(section.id);
    console.log(`[Wiki] Created sub-page: ${section.id}`);
  }

  // Convert original page into a hub/TOC
  let hubContent = `# ${originalTitle}\n\n`;
  hubContent += `> This page has been organized into the following sections:\n\n`;
  for (const section of sections) {
    hubContent += `- [${section.title}](${section.id})\n`;
  }
  await fs.writeFile(pagePath, hubContent, "utf-8");
  console.log(`[Wiki] Converted "${pageId}" into hub page`);

  // Rebuild graph
  await buildGraphFull();

  return { success: true, createdPages };
}

// --- Log ---

export async function appendToLog(logEntry: string) {
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
