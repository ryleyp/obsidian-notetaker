import { applyCorrections, applyReplacements } from "./sanitize";

// Everything an email or Teams thread note can send to a model, assembled for
// the Privacy Review scan. The scan has to cover each input that reaches the
// prompt: anything missing here is only discovered by the fail-closed boundary
// after the user has already approved the review. That includes the existing
// note, which rides along as a source when a thread note is being updated.
export function buildThreadScanText({
  title,
  thread,
  context,
  participants,
  folder,
  accountName,
  ownerNames = [],
  existingNote,
  corrections = [],
  replacements = [],
}) {
  const prepare = (text) => applyReplacements(applyCorrections(text, corrections), replacements);
  return [
    prepare(title),
    prepare(thread),
    prepare(context),
    applyReplacements(participants ?? "", replacements),
    applyReplacements(folder ?? "", replacements),
    applyReplacements(accountName ?? "", replacements),
    ...(ownerNames || []).map((name) => applyReplacements(name ?? "", replacements)),
    prepare(existingNote),
  ]
    .filter((part) => part && part.trim())
    .join("\n\n");
}
