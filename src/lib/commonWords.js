// Everyday English words, used to tell a capitalized ordinary word ("the
// Security team") from a name. The lists are the SCOWL word lists as packaged
// by wordlist-english: plain JSON arrays, read from disk, no network.
//
// Only the frequency tiers up to 50 are loaded. The rarer tiers add words
// almost nobody says in a meeting, and every extra word is one more surname
// that could be mistaken for vocabulary.
import english10 from "wordlist-english/english-words-10.json";
import english20 from "wordlist-english/english-words-20.json";
import english35 from "wordlist-english/english-words-35.json";
import english40 from "wordlist-english/english-words-40.json";
import english50 from "wordlist-english/english-words-50.json";
import american10 from "wordlist-english/american-words-10.json";
import american20 from "wordlist-english/american-words-20.json";
import american35 from "wordlist-english/american-words-35.json";
import american40 from "wordlist-english/american-words-40.json";
import american50 from "wordlist-english/american-words-50.json";

let words = null;

export function isCommonEnglishWord(word) {
  if (!words) {
    words = new Set();
    for (const list of [
      english10, english20, english35, english40, english50,
      american10, american20, american35, american40, american50,
    ]) {
      for (const entry of list) words.add(entry);
    }
  }
  return words.has(String(word || "").toLowerCase());
}
