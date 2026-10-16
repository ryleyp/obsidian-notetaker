export function applyCorrections(text, corrections) {
  if (!corrections?.length) return text;
  let result = text;
  for (const { find, replace } of corrections) {
    if (!find?.trim()) continue;
    result = result.replaceAll(find, replace ?? "");
  }
  return result;
}

export function correctionFromRestoredItem(item) {
  const find = String(item?.text || "").trim();
  const replace = String(item?.restored || "").trim();
  if (!find || !replace || find === replace) return null;
  return { find, replace };
}

export function mergeCorrections(corrections = [], additions = []) {
  const merged = [...corrections];
  const byFind = new Map();

  merged.forEach((correction, index) => {
    const find = String(correction?.find || "").trim();
    if (find) byFind.set(find.toLowerCase(), index);
  });

  for (const addition of additions) {
    const find = String(addition?.find || "").trim();
    const replace = String(addition?.replace ?? "");
    if (!find) continue;

    const key = find.toLowerCase();
    if (byFind.has(key)) {
      merged[byFind.get(key)] = { ...merged[byFind.get(key)], find, replace };
    } else {
      byFind.set(key, merged.length);
      merged.push({ find, replace });
    }
  }

  return merged;
}


function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Match a term as a whole word where possible. Anchoring with word boundaries
// keeps a short term/alias from matching inside a longer one — e.g. reversing
// "ORG_1" must not corrupt "ORG_12". Boundaries are only added on sides where
// the term edge is itself a word character (so "C++" still matches).
function wordBoundaryRegex(term, flags) {
  const esc = escapeRegex(term);
  const left = /^\w/.test(term) ? "\\b" : "";
  const right = /\w$/.test(term) ? "\\b" : "";
  return new RegExp(`${left}${esc}${right}`, flags);
}

export function applyReplacements(text, replacements) {
  let result = String(text ?? "");
  // Replace the most specific values first. Without this, a saved "Jane"
  // mapping can turn "Jane Doe" into "PERSON_1 Doe" before the full-name
  // mapping gets a chance to run, leaking part of the name.
  const ordered = [...(replacements || [])].sort(
    (a, b) => String(b?.original || "").length - String(a?.original || "").length
  );
  for (const r of ordered) {
    if (!r?.skip && r.original && r.alias) {
      result = result.replace(wordBoundaryRegex(String(r.original), "gi"), String(r.alias));
    }
  }
  return result;
}

export function reverseReplacements(text, replacements) {
  let result = String(text ?? "");
  const ordered = [...(replacements || [])].sort(
    (a, b) => String(b?.alias || "").length - String(a?.alias || "").length
  );
  for (const r of ordered) {
    if (!r?.skip && r.alias && (r.restored || r.original)) {
      result = result.replace(wordBoundaryRegex(String(r.alias), "gi"), String(r.restored || r.original));
    }
  }
  return result;
}

export function assignAliases(entities, existingReplacements) {
  const usedAliases = new Set((existingReplacements || []).map((r) => r?.alias).filter(Boolean));
  return entities.map((e) => {
    let alias;
    do {
      const bytes = new Uint8Array(6);
      if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
      else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
      alias = `PRIVATE_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    } while (usedAliases.has(alias));
    usedAliases.add(alias);
    return { ...e, alias };
  });
}
