import { describe, expect, it } from "vitest";
import { buildPrompt, promptTemplateText as meetingTemplate } from "./process/route";
import { buildEmailThreadPrompt, promptTemplateText as threadTemplate } from "./email-thread/route";
import { assertOutboundPrivacy } from "@/lib/privacyBoundary";

// Names that appear as examples in our own instruction text. A user's
// glossary will often contain a real contact or account that matches one.
const GLOSSARY = ["Dana", "Jordan", "Priya", "Marcus", "Acme", "Acme Aerospace", "Cardinal", "Cardinal Defense", "Beacon Systems", "Whitfield", "Florida", "Teams", "Outlook"];
const body = "PRIVATE_AAAAAAAAAAAA: Let's confirm the migration by Friday.\nPRIVATE_BBBBBBBBBBBB: I will send the steps.";
const send = (content, templateText) => () => assertOutboundPrivacy(
  { messages: [{ role: "user", content }] },
  { sensitiveTerms: GLOSSARY, templateText }
);

describe("anonymized prompts clear the privacy boundary", () => {
  it("lets an anonymized meeting transcript through despite example names in the instructions", () => {
    expect(send(buildPrompt(body, "PRIVATE_CCCCCCCCCCCC sync"), meetingTemplate())).not.toThrow();
  });

  it.each(["email", "teams"])("lets an anonymized %s thread through", (threadKind) => {
    const prompt = buildEmailThreadPrompt({ emailThread: body, threadTitle: "PRIVATE_CCCCCCCCCCCC", threadKind });
    expect(send(prompt, threadTemplate())).not.toThrow();
  });

  it("still blocks a glossary name left in the transcript", () => {
    expect(send(buildPrompt("Dana: hello", "Sync"), meetingTemplate())).toThrow(/blocked this AI request/);
    const prompt = buildEmailThreadPrompt({ emailThread: "Dana: hello", threadTitle: "Sync", threadKind: "teams" });
    expect(send(prompt, threadTemplate())).toThrow(/blocked this AI request/);
  });

  it("keeps real names out of the instruction text", () => {
    const all = [meetingTemplate(), threadTemplate()].join("\n");
    expect(all).not.toMatch(/Priddy/);
  });
});
