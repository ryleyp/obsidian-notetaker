import { describe, expect, it } from "vitest";
import {
  SFDC_TAXONOMY,
  isCanonicalPair,
  normalizeSfdcSubtype,
  normalizeSfdcType,
  taxonomyForNotePrompt,
  taxonomyForReportPrompt,
} from "./sfdcTaxonomy";

describe("sfdcTaxonomy normalization", () => {
  it("keeps canonical values unchanged", () => {
    expect(normalizeSfdcType("Strategic Relationship Management")).toBe("Strategic Relationship Management");
    expect(normalizeSfdcSubtype("Strategic Relationship Management", "QBRs/EBRs")).toBe("QBRs/EBRs");
  });

  it("maps the old New Note spellings onto the SFDC picklist values", () => {
    expect(normalizeSfdcType("Internal Alignment and Collaboration")).toBe("Internal Alignment & Collaboration");
    expect(normalizeSfdcSubtype("Internal Alignment and Collaboration", "Account Team Kickoff")).toBe("Account Team Kick-Off");
    expect(normalizeSfdcSubtype("Strategic Relationship Management", "Escalation / Risk Management")).toBe("Escalation/Risk Management");
    expect(normalizeSfdcSubtype("Strategic Relationship Management", "QBR / EBR")).toBe("QBRs/EBRs");
    expect(normalizeSfdcSubtype("Strategic Relationship Management", "SystemLink Enterprise Governance")).toBe("SLE Governance");
    expect(normalizeSfdcSubtype("Strategic Relationship Management", "Product Roadmap Review")).toBe("Roadmap Review");
    expect(normalizeSfdcSubtype("User Groups", "Demo Day")).toBe("Demo Days");
    expect(normalizeSfdcSubtype("Value Realization and Success Stories", "SystemLink ROI Review")).toBe("SLE ROI Review");
  });

  it("folds the old top-level webinar type into Entitlement Awareness", () => {
    expect(normalizeSfdcType("Training or Support Webinar")).toBe("Entitlement Awareness & Promotion");
    expect(normalizeSfdcSubtype("Training or Support Webinar", "Other")).toBe("Training/Support Webinar");
  });

  it("is case and whitespace insensitive", () => {
    expect(normalizeSfdcType("  user groups ")).toBe("User Groups");
    expect(normalizeSfdcSubtype("User Groups", "user group")).toBe("User Group");
  });

  it("every normalized alias lands on a canonical pair", () => {
    expect(isCanonicalPair("Onboarding & Kick-Off", normalizeSfdcSubtype("Onboarding & Kick-off", "EA End-User Kick-off"))).toBe(true);
    expect(isCanonicalPair("User Groups", "Demo Day")).toBe(false);
  });
});

describe("taxonomy prompt renderings", () => {
  it("lists every type and subtype in the note prompt", () => {
    const text = taxonomyForNotePrompt();
    for (const t of SFDC_TAXONOMY) {
      expect(text).toContain(t.type);
      for (const s of t.subtypes) expect(text).toContain(s.name);
    }
  });

  it("carries descriptions and examples into the report prompt", () => {
    const text = taxonomyForReportPrompt();
    expect(text).toContain("**Type: User Groups**");
    expect(text).toContain("Comment format:");
    expect(text).toContain("Example: \"Beacon Systems RF User Group");
  });
});
