import nlp from "compromise";
import { isCommonEnglishWord } from "./commonWords";

const PUBLIC_TERMS = new Set([
  "ni", "labview", "teststand", "systemlink", "diadem", "flexlogger", "veristand",
  "ni-daqmx", "labwindows/cvi", "measurement studio", "ni-visa", "opentestbed",
]);

// Capitalized terms the proper-noun pass leaves alone. Every entry is a
// product, tool, program, or section name that this app's own prompts already
// state in the clear, so sending one discloses nothing about a customer, while
// replacing one with an alias would hide what the meeting was about. Words
// that double as a person's name (Julia, Claude) are deliberately absent.
const PUBLIC_PROPER_TERMS = new Set([
  "national instruments", "instrumentstudio", "daqmx", "compactdaq", "cdaq", "compactrio", "crio",
  "python", "matlab", "simulink", "java", "javascript", "typescript", "dotnet", "rust",
  "github", "azure", "jira", "confluence", "salesforce", "teams", "outlook", "windows", "linux",
  "excel", "word", "powerpoint", "sharepoint", "onedrive", "obsidian", "todoist", "voice memo", "voice memos",
  "enterprise agreement", "enterprise agreements", "proficiency plan", "proficiency plans", "flex credits",
  "training credits", "customer success", "demo days", "user group", "user groups",
  "executive summary", "meeting notes", "action items", "next steps",
]);

const ALIAS_PATTERN = /^(?:(?:PERSON|ORG|LOCATION|EMAIL|PHONE|ADDRESS|IP|URL|SECRET|ID)_\d+|PRIVATE_[A-F0-9]{12})$/i;

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

// ---------------------------------------------------------------------------
// Proper-noun pass
//
// people(), organizations() and places() only return names the engine's word
// list already knows, so an uncommon name ("Priya Natarajan will send the
// quote") came back empty and went to the model as written. English marks a
// proper noun by capitalizing it, and the one place that signal is missing is
// the start of a sentence, where every word is capitalized. So:
//
//   - a capitalized word that is NOT at a sentence start is a name candidate,
//     and neighbouring candidates join into one term ("Halvorsen Dynamics");
//   - a candidate that is an ordinary dictionary word ("the Engineering team",
//     "our Quarterly Business Review") is not a name by itself. A stretch of
//     candidates is flagged only when at least one word in it is not an
//     ordinary word, and is then flagged whole, so "Dynamics" stays with
//     "Halvorsen";
//   - a capitalized word AT a sentence start counts only when the word list
//     marks it as a name, or when it is unknown to the word list and leads
//     straight into a candidate ("Priya" in "Priya Natarajan will ...");
//   - a word from a flagged multi-word name is also flagged on its own when it
//     appears alone ("Priya said ..."), since whole-term replacement would
//     otherwise leave that mention behind.
//
// Replacement ignores case, so flagging "Engineering" would also swap every
// "engineering" in the transcript for an alias. That is why ordinary words are
// left out: the cost is not one extra row on the card, it is the model reading
// a transcript with its plain vocabulary removed.
//
// The price is a name that is also an ordinary word and that the engine's name
// list does not know ("Stone", "Baker"). With a first name beside it the typed
// passes above usually still catch it; mentioned alone it is not flagged.
// ---------------------------------------------------------------------------

const NAME_TAGS = new Set([
  "FirstName", "MaleName", "FemaleName", "LastName", "Person", "Honorific",
  "Place", "City", "Country", "Region", "Organization", "Company", "ProperNoun",
  // "German", "Texans": not a name, but it says where a team or customer is.
  "Demonym",
]);
const DATE_TAGS = ["Month", "WeekDay", "Holiday"];
// Anything that ends a sentence or opens a new unit of text: after one of
// these, a capital letter says nothing about whether the word is a name.
const BOUNDARY = /[.!?:;\n"“”()[\]—–|*#>]/;
const MAX_RUN_WORDS = 5;

let lexicon = null;
function lexiconTags(word) {
  if (!lexicon) lexicon = nlp.model().one.lexicon;
  const key = word.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(lexicon, key)) return null;
  const tags = lexicon[key];
  return Array.isArray(tags) ? tags : [tags];
}

const isNameInLexicon = (word) => (lexiconTags(word) || []).some((tag) => NAME_TAGS.has(tag));
// An ordinary dictionary word with no name sense: never worth flagging alone.
// The engine's own word list is small ("business" and "security" are missing
// from it), so a full English word list backs it up. A word the engine marks
// as a name stays a name whatever the dictionary says.
const isOrdinaryWord = (word) => {
  const tags = lexiconTags(word);
  if (tags) return !tags.some((tag) => NAME_TAGS.has(tag));
  return isCommonEnglishWord(word);
};

// The engine's Pronoun tag is trusted only for a word that really is one
// ("I'll", "He's"). It sometimes lands on an unfamiliar capitalized word, and
// taking its word for that would let a name through.
function isPronoun(word) {
  const base = word.replace(/['’](?:m|ll|ve|d|re|s)$/i, "");
  return base.toLowerCase() === "i" || (lexiconTags(base) || []).includes("Pronoun");
}

function isPublicOrAlias(text) {
  const key = text.toLowerCase();
  return PUBLIC_TERMS.has(key) || PUBLIC_PROPER_TERMS.has(key) || ALIAS_PATTERN.test(text);
}

function bareWord(termText) {
  return String(termText || "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/['’]s$/i, "");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectProperNouns(document, source, found) {
  const add = (text) => {
    const key = text.toLowerCase();
    if (!text || isPublicOrAlias(text) || found.has(key)) return false;
    found.set(key, { text, type: "name" });
    return true;
  };
  const multiWord = [];

  for (const sentence of document.json()) {
    let run = [];
    // How each word after the first was attached in the source: a space, or a
    // hyphen for "Wright-Patterson". The term has to be rebuilt exactly as it
    // was written or the replacement would not find it.
    let joiners = [];
    let keep = false;
    const flush = () => {
      if (run.length && keep) {
        if (run.length === 1) add(run[0]);
        else if (run.length <= MAX_RUN_WORDS) {
          const text = run.reduce((whole, word, index) => (index ? `${whole}${joiners[index - 1]}${word}` : word), "");
          if (!isPublicOrAlias(text)) multiWord.push(text);
          add(text);
        } else {
          // A long capitalized stretch is a heading, not one name. Its words
          // are still candidates, minus the ordinary ones.
          for (const word of run) if (!isOrdinaryWord(word)) add(word);
        }
      }
      run = [];
      joiners = [];
      keep = false;
    };

    let afterBoundary = true;
    for (const term of sentence.terms || []) {
      const word = bareWord(term.text);
      const tags = term.tags || [];

      // "Okonkwo/Kowalczyk" arrives as one token. Each side is its own term,
      // so that a later mention of either one alone is replaced too.
      if (word.includes("/")) {
        flush();
        for (const piece of word.split("/").map(bareWord)) {
          const titled = piece.length > 1 && /^\p{Lu}/u.test(piece) && /\p{Ll}/u.test(piece);
          if (titled && !isOrdinaryWord(piece)) add(piece);
        }
        afterBoundary = BOUNDARY.test(term.post || "");
        continue;
      }

      // Title case or camel case. An all-capitals token is an acronym, which
      // this pass does not judge: see the note in the README.
      const capitalized = word.length > 1 && /^\p{Lu}/u.test(word) && /\p{Ll}/u.test(word);
      const candidate = capitalized
        && !(tags.includes("Pronoun") && isPronoun(word))
        && !/^i['’]/i.test(word)
        && !isPublicOrAlias(word);
      const sentenceStart = afterBoundary || BOUNDARY.test(term.pre || "");
      const dateWord = DATE_TAGS.some((tag) => tags.includes(tag));

      if (candidate && !sentenceStart && !dateWord) {
        // An ordinary word joins the stretch but cannot justify it.
        run.push(word);
        if (!isOrdinaryWord(word)) keep = true;
      } else if (candidate && sentenceStart && isNameInLexicon(word)) {
        run.push(word);
        keep = true;
      } else if (candidate && sentenceStart && !isOrdinaryWord(word)) {
        // Unknown word at a sentence start: kept only if a name follows it.
        run.push(word);
      } else if (candidate && dateWord && run.length) {
        // "April Whitfield": a month or weekday inside a name stays in it.
        run.push(word);
      } else {
        flush();
      }

      // A name continues across a space or a hyphen and nothing else: a
      // comma, slash, or any other mark between two capitalized words means
      // two separate terms.
      const post = term.post || "";
      afterBoundary = BOUNDARY.test(post);
      const hyphen = /^[-‐‑]$/.test(post);
      if (afterBoundary || !(hyphen || /^\s*$/.test(post))) flush();
      else if (run.length) joiners.push(hyphen ? post : " ");
    }
    flush();
  }

  // Standalone mentions of a word from a flagged multi-word name.
  if (multiWord.length) {
    let remainder = source;
    for (const text of [...multiWord].sort((a, b) => b.length - a.length)) {
      remainder = remainder.split(text).join(" ");
    }
    for (const text of multiWord) {
      for (const word of text.split(/[\s‐‑-]+/)) {
        if (word.length < 3 || found.has(word.toLowerCase()) || isOrdinaryWord(word) || isPublicOrAlias(word)) continue;
        const alone = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?![\\p{L}\\p{N}])`, "u");
        if (alone.test(remainder)) add(word);
      }
    }
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
    const chunk = source.slice(start, start + chunkSize);
    const document = nlp(chunk);
    // The typed passes run first so a name the engine recognizes keeps its
    // person / organization / location label.
    collect(document.people(), "person", found);
    collect(document.organizations(), "org", found);
    collect(document.places(), "location", found);
    collectProperNouns(document, chunk, found);
    if (start + chunkSize >= source.length) break;
  }
  return [...found.values()];
}
