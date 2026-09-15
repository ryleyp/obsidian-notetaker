// Planning the one-time move of existing notes into fiscal-year folders.
//
// Pure path logic, so the plan can be shown and checked before a single file
// moves. A note is filed by the date in its own name; a note with no date in
// its name is left exactly where it is rather than guessed at.

import { currentFiscalYearFolder, fiscalYearFolderForTitle, isFiscalYearFolderName } from "./fiscalYear";

// The app's own per-account rollups. They carry no date, so they are only
// moved when the caller asks for it, and then into the open fiscal year.
const ROLLUP_PATTERNS = [
  /customer facts & callouts/i,
  /customer (& )?site mapping/i,
];

export const isRollupName = (filename) => ROLLUP_PATTERNS.some((pattern) => pattern.test(filename));

const SEPARATOR = /[\\/]/;

export function planFiscalYearMoves(relativePaths = [], {
  includeRollups = false,
  currentFolder = currentFiscalYearFolder(),
} = {}) {
  const moves = [];
  const skipped = [];

  for (const relativePath of relativePaths) {
    const segments = String(relativePath || "").split(SEPARATOR).filter(Boolean);
    const filename = segments[segments.length - 1] || "";
    if (!filename.toLowerCase().endsWith(".md")) continue;

    // A file sitting at the vault root belongs to no account, so there is no
    // account folder to create a fiscal year inside.
    if (segments.length < 2) {
      skipped.push({ relativePath, reason: "root" });
      continue;
    }

    const parent = segments.slice(0, -1);
    if (isFiscalYearFolderName(parent[parent.length - 1])) {
      skipped.push({ relativePath, reason: "already-filed" });
      continue;
    }

    let folder = fiscalYearFolderForTitle(filename);
    let rollup = false;
    if (!folder && isRollupName(filename)) {
      if (!includeRollups) {
        skipped.push({ relativePath, reason: "rollup" });
        continue;
      }
      folder = currentFolder;
      rollup = true;
    }
    if (!folder) {
      skipped.push({ relativePath, reason: "undated" });
      continue;
    }

    moves.push({
      from: relativePath,
      to: [...parent, folder, filename].join("/"),
      account: parent[0],
      fiscalYear: folder,
      rollup,
    });
  }

  return { moves, skipped };
}

// Moves grouped by the account folder they belong to, each account's years in
// order, for a preview the CSM can actually read.
export function groupMovesByAccount(moves = []) {
  const byAccount = new Map();
  for (const move of moves) {
    if (!byAccount.has(move.account)) byAccount.set(move.account, new Map());
    const years = byAccount.get(move.account);
    if (!years.has(move.fiscalYear)) years.set(move.fiscalYear, 0);
    years.set(move.fiscalYear, years.get(move.fiscalYear) + 1);
  }
  return [...byAccount.entries()]
    .map(([account, years]) => ({
      account,
      total: [...years.values()].reduce((sum, n) => sum + n, 0),
      years: [...years.entries()].map(([fiscalYear, count]) => ({ fiscalYear, count }))
        .sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear)),
    }))
    .sort((a, b) => a.account.localeCompare(b.account));
}
