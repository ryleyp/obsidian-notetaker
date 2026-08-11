import { describe, expect, it } from "vitest";
import { buildCustomerFactsRollup, markdownSections } from "./customerFacts";

describe("customer facts rollup", () => {
  it("extracts level-two Markdown sections", () => {
    const sections = markdownSections("# Note\n\n## User-Level Callouts\n\n- **Dana** — admin\n\n---\n\n## Next Steps\n\n- Follow up");
    expect(sections.get("user-level callouts")).toContain("Dana");
    expect(sections.get("next steps")).toContain("Follow up");
  });

  it("combines people, site, and CS callouts with source links", () => {
    const output = buildCustomerFactsRollup([
      {
        filename: "2025-01-10 - Kickoff.md",
        content: "## User-Level Callouts\n\n- **Dana** — EA admin\n\n## Site-Level Callouts\n\n- **Dallas lab** — rollout site\n\n## Things NI SW Customer Success Should Take Note Of\n\n- License risk",
      },
      {
        filename: "2025-02-10 - Review.md",
        content: "## User-Level Callouts\n\nNothing noted.\n\n## Site-Level Callouts\n\n- **Austin lab** — pilot",
      },
    ], "Acme", new Date("2025-03-01T00:00:00.000Z"));

    expect(output).toContain("# Acme - Customer Facts & Callouts");
    expect(output).toContain("[[2025-01-10 - Kickoff]]");
    expect(output).toContain("Dana");
    expect(output).toContain("Dallas lab");
    expect(output).toContain("Austin lab");
    expect(output).toContain("License risk");
    expect(output).not.toContain("### [[2025-02-10 - Review]] · 2025-02-10\n\nNothing noted");
  });
});
