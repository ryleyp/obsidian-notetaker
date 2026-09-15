import { describe, expect, it } from "vitest";
import {
  currentFiscalYearFolder,
  dateFromTitle,
  fiscalYearForDate,
  fiscalYearFolderForTitle,
  fiscalYearFolderName,
  fiscalYearFromFolderName,
  fiscalYearRangeLabel,
  isFiscalYearFolderName,
} from "./fiscalYear";

describe("fiscalYearForDate", () => {
  it("names the year the fiscal year ends in", () => {
    expect(fiscalYearForDate(new Date("2025-11-04T12:00:00"))).toBe(2026);
    expect(fiscalYearForDate(new Date("2026-09-08T12:00:00"))).toBe(2026);
  });

  it("rolls over on October 1, not January 1", () => {
    expect(fiscalYearForDate(new Date("2026-09-30T12:00:00"))).toBe(2026);
    expect(fiscalYearForDate(new Date("2026-10-01T12:00:00"))).toBe(2027);
    expect(fiscalYearForDate(new Date("2026-12-31T12:00:00"))).toBe(2027);
    expect(fiscalYearForDate(new Date("2027-01-01T12:00:00"))).toBe(2027);
  });

  it("returns nothing for an unparseable date", () => {
    expect(fiscalYearForDate("not a date")).toBeNull();
  });
});

describe("folder names", () => {
  it("round-trips a folder name", () => {
    expect(fiscalYearFolderName(2026)).toBe("FY2026");
    expect(fiscalYearFromFolderName("FY2026")).toBe(2026);
    expect(fiscalYearFolderName(null)).toBe("");
  });

  it("recognises only a real fiscal-year folder", () => {
    expect(isFiscalYearFolderName("FY2026")).toBe(true);
    expect(isFiscalYearFolderName("fy2026")).toBe(true);
    expect(isFiscalYearFolderName("FY26")).toBe(false);
    expect(isFiscalYearFolderName("FY2026 Planning")).toBe(false);
    expect(isFiscalYearFolderName("Acme")).toBe(false);
    expect(isFiscalYearFolderName("")).toBe(false);
  });
});

describe("fiscalYearFolderForTitle", () => {
  it("files a note by the date in its title", () => {
    expect(fiscalYearFolderForTitle("2026-09-08 - Acme Sync")).toBe("FY2026");
    expect(fiscalYearFolderForTitle("2026-10-01 - Acme Kickoff")).toBe("FY2027");
    expect(fiscalYearFolderForTitle("EA Activity Report 2025-11-20")).toBe("FY2026");
  });

  it("leaves an undated note unfiled rather than guessing", () => {
    expect(fiscalYearFolderForTitle("Customer Facts & Callouts")).toBe("");
    expect(fiscalYearFolderForTitle("")).toBe("");
    // A year alone is not a date.
    expect(fiscalYearFolderForTitle("2026 Planning")).toBe("");
  });

  it("does not let a timezone offset move a note across the year boundary", () => {
    expect(fiscalYearFolderForTitle("2026-09-30 - Last day of FY2026")).toBe("FY2026");
    expect(fiscalYearFolderForTitle("2026-10-01 - First day of FY2027")).toBe("FY2027");
  });
});

describe("dateFromTitle", () => {
  it("reads the date wherever it sits in the title", () => {
    expect(dateFromTitle("2026-09-08 - Acme Sync")).toBe("2026-09-08");
    expect(dateFromTitle("Acme Sync 2026-09-08")).toBe("2026-09-08");
    expect(dateFromTitle("Acme Sync")).toBe("");
  });
});

describe("currentFiscalYearFolder and labels", () => {
  it("reports the fiscal year a given day falls in", () => {
    expect(currentFiscalYearFolder(new Date("2026-09-15T12:00:00"))).toBe("FY2026");
    expect(currentFiscalYearFolder(new Date("2026-10-02T12:00:00"))).toBe("FY2027");
  });

  it("labels the span a fiscal year covers", () => {
    expect(fiscalYearRangeLabel(2026)).toBe("October 2025 – September 2026");
    expect(fiscalYearRangeLabel(null)).toBe("");
  });
});
