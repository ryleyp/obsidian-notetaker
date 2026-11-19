import { describe, expect, it } from "vitest";
import { buildAccountContext } from "./accountContext";

const note = (filename, body) => ({ filename, content: body });

describe("buildAccountContext", () => {
  it("keeps the status sections of the newest notes, newest first, without citations", () => {
    const { context, sources } = buildAccountContext([
      note("2026-09-01 - Kickoff.md", "## Executive Summary\n\nKickoff held. [T1]\n\n## Action Items\n\n- [ ] Send the plan — **Owner:** CSM | **Due:** TBD [T2]"),
      note("2026-10-05 - Email - License count.md", "## Thread Summary\n\n- Count confirmed at 40. [E1]\n\n**Response needed:** No\n\n## Attendee Callouts\n\nDana is the admin."),
    ]);

    expect(sources).toEqual(["2026-10-05 - Email - License count.md", "2026-09-01 - Kickoff.md"]);
    expect(context.indexOf("License count")).toBeLessThan(context.indexOf("Kickoff"));
    expect(context).toContain("Count confirmed at 40.");
    expect(context).toContain("Send the plan");
    expect(context).not.toMatch(/\[[TE]\d\]/);
    expect(context).not.toContain("Response needed");
    // Callout sections are internal commentary, not account status.
    expect(context).not.toContain("Dana is the admin");
  });

  it("skips undated notes, excluded notes, and notes with nothing to carry", () => {
    const { sources } = buildAccountContext([
      note("Customer Facts & Callouts.md", "## Executive Summary\n\nRollup."),
      note("2026-10-01 - Email - Own thread.md", "## Thread Summary\n\n- This thread."),
      note("2026-10-02 - Empty.md", "## Decisions\n\nNo explicit decisions in this thread."),
      note("2026-10-03 - Sync.md", "## Next Steps\n\n- Pilot in November."),
    ], { exclude: (n) => n.filename.includes("Own thread") });

    expect(sources).toEqual(["2026-10-03 - Sync.md"]);
  });

  it("stays inside the note and size limits", () => {
    const notes = Array.from({ length: 12 }, (_, i) => note(
      `2026-10-${String(i + 1).padStart(2, "0")} - Sync ${i}.md`,
      `## Executive Summary\n\n${"Detail line.\n".repeat(400)}`
    ));
    const { context, sources } = buildAccountContext(notes, { maxNotes: 4, perNoteChars: 500, maxChars: 1500 });

    expect(sources.length).toBeLessThanOrEqual(4);
    expect(context.length).toBeLessThanOrEqual(1600);
    expect(sources[0]).toContain("2026-10-12");
  });

  it("returns nothing for an empty folder", () => {
    expect(buildAccountContext([])).toEqual({ context: "", sources: [] });
  });
});
