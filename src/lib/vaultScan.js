// Shared vault scanning for maintenance features (Todoist backfill, action
// item cleanup): which note files exist per folder, and how old each note is.

import fs from "fs";
import path from "path";

// Folders holding generated side files whose items duplicate the meeting and
// email notes they came from.
export const EXCLUDED_FOLDERS = new Set(["todos", "reports", "follow up emails"]);

export const EXCLUDED_FILE_PATTERNS = [
  /customer facts & callouts/i,
  /customer (& )?site mapping/i,
  /todos from meetings/i,
  /sfdc activity report/i,
];

export function noteDate(filePath, filename, content) {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/) || content.match(/^#[^\n]*?(\d{4}-\d{2}-\d{2})/m);
  if (match) {
    const parsed = new Date(`${match[1]}T12:00:00`);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  try {
    return fs.statSync(filePath).mtime;
  } catch {
    return null;
  }
}

// Every folder that can hold notes (vault root included), excluding hidden
// and side-file folders. Returns [{ dirPath, folder }] with vault-relative
// folder paths.
export function collectFolders(dir, relativeFolder = "", depth = 0, maxDepth = 3) {
  const folders = [{ dirPath: dir, folder: relativeFolder }];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return folders;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (EXCLUDED_FOLDERS.has(entry.name.trim().toLowerCase())) continue;
    if (depth < maxDepth) {
      folders.push(...collectFolders(path.join(dir, entry.name), path.join(relativeFolder, entry.name), depth + 1, maxDepth));
    }
  }
  return folders;
}

export function collectNoteFiles(dir, relativeFolder = "", depth = 0, maxDepth = 3) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_FOLDERS.has(entry.name.trim().toLowerCase())) continue;
      if (depth < maxDepth) {
        files.push(...collectNoteFiles(fullPath, path.join(relativeFolder, entry.name), depth + 1, maxDepth));
      }
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
    if (EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) continue;
    files.push({ filePath: fullPath, filename: entry.name, folder: relativeFolder });
  }
  return files;
}
