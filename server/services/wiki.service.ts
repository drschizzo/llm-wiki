import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { DATA_DIR, WIKI_DIR } from "../config";
import { buildGraphFull } from "./graph.service";

const PROCESSED_FILES_DB = path.join(DATA_DIR, "processed_hashes.json");

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

export async function applyWikiUpdates(updates: any[]) {
  if (!updates || !Array.isArray(updates)) return;
  for (const update of updates) {
    if (!update.id || !update.content) continue;
    const filePath = path.join(WIKI_DIR, `${update.id}.md`);
    await fs.writeFile(filePath, update.content, "utf-8");
  }
  await buildGraphFull();
}

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
