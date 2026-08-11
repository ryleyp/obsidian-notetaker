export const CUSTOMER_FACTS_FILENAME = "Customer Facts & Callouts.md";

const SECTION_GROUPS = [
  {
    title: "People & Attendee Callouts",
    headings: [
      "User-Level Callouts",
      "Attendee Callouts",
      "Customer / Attendee Callouts",
      "Customer Stakeholder Callouts",
      "Customer Stakeholders",
    ],
  },
  {
    title: "Site-Level Callouts",
    headings: [
      "Site-Level Callouts",
      "Site / Lab / Location Map",
      "Site Callouts",
    ],
  },
  {
    title: "Customer Success Callouts & Facts",
    headings: [
      "Things NI SW Customer Success Should Take Note Of",
      "Customer Success Callouts",
      "CS Callouts",
      "Customer Facts",
    ],
  },
];

function normalizeHeading(value) {
  return String(value || "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function markdownSections(markdown = "") {
  const sections = new Map();
  let heading = null;
  let lines = [];

  function flush() {
    if (!heading) return;
    const body = lines.join("\n").replace(/^\s*---\s*$/gm, "").trim();
    if (body) sections.set(normalizeHeading(heading), body);
  }

  for (const line of String(markdown).replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      flush();
      heading = match[1];
      lines = [];
    } else if (heading) {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function usefulBody(body) {
  const normalized = String(body || "").trim().toLowerCase().replace(/[.!]+$/, "");
  return normalized
    && normalized !== "nothing noted"
    && normalized !== "none noted"
    && !normalized.startsWith("no stakeholder or site details noted");
}

function dateFromNote(note) {
  if (note.date) return note.date;
  return String(note.filename || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
}

function noteLink(filename) {
  return String(filename || "Untitled").replace(/\.md$/i, "");
}

export function buildCustomerFactsRollup(notes = [], accountName = "Selected Customer", updatedAt = new Date()) {
  const sorted = [...notes].sort((a, b) => {
    const dateCompare = dateFromNote(b).localeCompare(dateFromNote(a));
    return dateCompare || String(b.filename || "").localeCompare(String(a.filename || ""));
  });

  const groupBlocks = SECTION_GROUPS.map((group) => {
    const headingKeys = new Set(group.headings.map(normalizeHeading));
    const entries = [];
    const seen = new Set();

    for (const note of sorted) {
      const sections = markdownSections(note.content);
      for (const [heading, body] of sections) {
        if (!headingKeys.has(heading) || !usefulBody(body)) continue;
        const key = `${note.filename}\n${body}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const date = dateFromNote(note);
        entries.push(`### [[${noteLink(note.filename)}]]${date ? ` · ${date}` : ""}\n\n${body}`);
      }
    }

    return `## ${group.title}\n\n${entries.length ? entries.join("\n\n---\n\n") : "Nothing noted."}`;
  });

  const timestamp = updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt);
  return `# ${accountName} - Customer Facts & Callouts

> [!info] Auto-generated customer index
> Rebuilt from the callout sections in this folder. Edit the source meeting note, then save or update it in Notetaker to refresh this index.

**Last rebuilt:** ${timestamp}

${groupBlocks.join("\n\n---\n\n")}
`;
}

export { SECTION_GROUPS };
