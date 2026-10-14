import { describe, expect, it } from "vitest";
import { latestEmailResponseDate } from "./emailDates";

describe("latestEmailResponseDate", () => {
  it("reads an RFC 2822 Date header", () => {
    const thread = "From: dana@example.com\nDate: Mon, 24 Aug 2026 14:03:11 -0500\n\nHi team,";
    expect(latestEmailResponseDate(thread)).toBe("2026-08-24");
  });

  it("reads an Outlook Sent header", () => {
    const thread = "From: Dana\nSent: Tuesday, August 25, 2026 8:01 AM\nTo: Ryley\n\nThanks!";
    expect(latestEmailResponseDate(thread)).toBe("2026-08-25");
  });

  it("reads Gmail-style attribution lines with a trailing sender name", () => {
    const thread = "Sounds good.\n\nOn Aug 26, 2026, at 2:03 PM, Dana Smith wrote:\n> Original message";
    expect(latestEmailResponseDate(thread)).toBe("2026-08-26");
  });

  it("picks the newest date when the thread spans multiple replies", () => {
    const thread = [
      "Date: Mon, 24 Aug 2026 09:00:00 -0500",
      "New reply on top.",
      "",
      "> Date: Fri, 21 Aug 2026 16:20:00 -0500",
      "> Older message.",
      "",
      "On Wed, Aug 19, 2026 at 11:00 AM Jordan Lee wrote:",
      "> Oldest message.",
    ].join("\n");
    expect(latestEmailResponseDate(thread)).toBe("2026-08-24");
  });

  it("reads quoted headers prefixed with >", () => {
    const thread = "> Sent: Monday, August 17, 2026 9:15 AM\n> To: Team\n>\n> Original ask";
    expect(latestEmailResponseDate(thread)).toBe("2026-08-17");
  });

  it("ignores dates in message bodies", () => {
    const thread = "The migration is due 2026-12-31 and kickoff was March 3, 2026.\nPlease confirm.";
    expect(latestEmailResponseDate(thread)).toBe("");
  });

  it("ignores header fragments without an explicit year", () => {
    const thread = "Sent: Tuesday, August 25\n\nBody text.";
    expect(latestEmailResponseDate(thread)).toBe("");
  });

  it("returns empty for empty or dateless input", () => {
    expect(latestEmailResponseDate("")).toBe("");
    expect(latestEmailResponseDate("Subject: Hello\n\nJust checking in.")).toBe("");
  });

  // Teams chat pastes have no Date:/Sent: headers — their timestamps are
  // standalone date-divider lines between messages.
  it("falls back to chat date-divider lines for Teams pastes", () => {
    const thread = [
      "October 8, 2026",
      "Priddy, Ryley 10:32 AM",
      "Can you confirm the license count?",
      "[Friday, October 10, 2026 2:30 PM]",
      "Smith, Jordan",
      "Confirmed, 45 seats.",
    ].join("\n");
    expect(latestEmailResponseDate(thread)).toBe("2026-10-10");
  });

  it("never lets a divider-looking body line override real email headers", () => {
    const thread = [
      "Sent: Monday, August 17, 2026 9:15 AM",
      "",
      "The kickoff moved.",
      "December 31, 2026",
    ].join("\n");
    expect(latestEmailResponseDate(thread)).toBe("2026-08-17");
  });

  it("ignores long prose lines that merely start with a date", () => {
    const thread = "October 10, 2026 is when the migration finally lands for the Dallas lab.\nPlease confirm.";
    expect(latestEmailResponseDate(thread)).toBe("");
  });
});
