// Where a file goes on disk once fiscal-year filing is on.
//
// Reading always treats an account folder as its whole subtree (see
// walkMarkdownFiles); only writing is routed into a year. Kept separate from
// fiscalYear.js so that module stays pure and usable in the browser.

import fs from "fs";
import path from "path";
import { resolveInsideDirectory } from "./fileSafety";
import { currentFiscalYearFolder, fiscalYearFolderForTitle, isFiscalYearFolderName } from "./fiscalYear";

// Returns the directory to write into, creating it when needed.
//   title     the note title, whose date decides the year
//   fallback  "current" files an undated file in the open fiscal year (the
//             rollups: customer facts, mapping, reports); "none" leaves it
//             where it is, which is what an undated meeting note wants
export function resolveFiscalYearDir(vaultRoot, targetDir, {
  enabled = false,
  title = "",
  fallback = "none",
  create = true,
} = {}) {
  if (!enabled) return targetDir;

  const target = path.resolve(targetDir);
  // A fiscal-year folder belongs inside an account, never at the vault root.
  if (target === path.resolve(vaultRoot)) return targetDir;

  const wanted = fiscalYearFolderForTitle(title) || (fallback === "current" ? currentFiscalYearFolder() : "");
  if (!wanted) return targetDir;

  // Selecting a year folder directly is honoured, except when the file's own
  // date belongs to a different year — then it goes to that year's folder
  // beside the selected one rather than being filed under the wrong year.
  const base = path.basename(target);
  if (isFiscalYearFolderName(base)) {
    if (base.toUpperCase() === wanted.toUpperCase()) return targetDir;
    const sibling = resolveInsideDirectory(path.dirname(target), wanted, "Fiscal year folder");
    if (create) fs.mkdirSync(sibling, { recursive: true });
    return sibling;
  }

  const dir = resolveInsideDirectory(target, wanted, "Fiscal year folder");
  if (create) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
