import nlp from "compromise";

const PUBLIC_TERMS = new Set([
  "ni", "labview", "teststand", "systemlink", "diadem", "flexlogger", "veristand",
  "ni-daqmx", "labwindows/cvi", "measurement studio", "ni-visa", "opentestbed",
]);

function clean(value) {
  return String(value || "").trim().replace(/^[\s,;:]+|[\s,;:.]+$/g, "");
}

function collect(view, type, found) {
  for (const raw of view.out("array")) {
    const text = clean(raw);
    if (!text || PUBLIC_TERMS.has(text.toLowerCase()) || /^(?:(?:PERSON|ORG|LOCATION)_\d+|PRIVATE_[A-F0-9]{12})$/i.test(text)) continue;
    const key = text.toLowerCase();
    if (!found.has(key)) found.set(key, { text, type });
  }
}

// Compromise is an in-process, rule-based English NER engine. It performs no
// network calls and needs no downloaded model, so source text stays local.
export function extractLocalNerEntities(text = "") {
  const source = String(text || "");
  const found = new Map();
  // Bound the parser's peak memory on large quarter-long note batches while
  // keeping overlap for an entity that straddles a chunk boundary.
  const chunkSize = 50_000;
  const overlap = 256;
  for (let start = 0; start < source.length || (start === 0 && !source.length); start += chunkSize - overlap) {
    const document = nlp(source.slice(start, start + chunkSize));
    collect(document.people(), "person", found);
    collect(document.organizations(), "org", found);
    collect(document.places(), "location", found);
    if (start + chunkSize >= source.length) break;
  }
  return [...found.values()];
}
