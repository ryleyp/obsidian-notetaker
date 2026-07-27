// Default account configuration. Editable in Settings and persisted to the
// portable config file. Each account maps a set of name aliases (used for
// cross-vault keyword search and folder auto-detection) to a transcript
// archive subfolder.
export const DEFAULT_ACCOUNTS = [
  { name: "Lockheed Martin", archiveFolder: "LM Transcripts", aliases: ["lockheed", "lmco", "mfc", "rms"] },
  { name: "L3Harris", archiveFolder: "L3 Transcripts", aliases: ["l3harris", "l3 harris"] },
  { name: "Northrop Grumman", archiveFolder: "NGC Transcripts", aliases: ["northrop", "ngc"] },
  { name: "Frontgrade", archiveFolder: "Frontgrade Transcripts", aliases: ["frontgrade"] },
];

const INTERNAL = { name: "Internal", archiveFolder: "Internal Transcripts", aliases: [] };

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Use the provided account list, or fall back to defaults when missing/empty.
function resolve(accounts) {
  return accounts && accounts.length ? accounts : DEFAULT_ACCOUNTS;
}

// Whole-word, case-insensitive test for an alias appearing anywhere in text.
// Word boundaries prevent false positives like "ngc" inside "engcomputer".
export function textHasAlias(text, alias) {
  const a = (alias || "").trim();
  if (!a) return false;
  const esc = escapeRegex(a);
  const left = /^\w/.test(a) ? "\\b" : "";
  const right = /\w$/.test(a) ? "\\b" : "";
  return new RegExp(`${left}${esc}${right}`, "i").test(text || "");
}

// Detect which account a selected Obsidian folder name belongs to.
// Uses substring matching since folder names are short and curated
// (e.g. "3. Northrop"). Falls back to Internal when nothing matches.
export function detectAccount(folderName, accounts) {
  const f = (folderName || "").toLowerCase();
  for (const acct of resolve(accounts)) {
    if ((acct.aliases || []).some((a) => f.includes(a.toLowerCase()))) {
      return { name: acct.name, archiveFolder: acct.archiveFolder, aliases: acct.aliases || [] };
    }
  }
  return { ...INTERNAL };
}

// Given free text (title + content), pick the best-matching vault folder path.
// Returns null when no account alias appears in the text or no folder matches.
export function matchVaultFolder(text, folders, accounts) {
  for (const acct of resolve(accounts)) {
    const aliases = acct.aliases || [];
    if (!aliases.some((a) => textHasAlias(text, a))) continue;
    const folder = (folders || []).find((fo) => {
      const fn = (fo.name || "").toLowerCase();
      if (acct.obsidianFolder && fn.includes(acct.obsidianFolder.toLowerCase())) return true;
      return aliases.some((a) => fn.includes(a.toLowerCase()));
    });
    if (folder) return folder.path;
  }
  return null;
}
