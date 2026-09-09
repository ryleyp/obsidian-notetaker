import Anthropic from "@anthropic-ai/sdk";
import { applyCorrections, applyReplacements } from "@/lib/sanitize";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { FAST_MODEL, firstTextBlock } from "@/lib/models";
import { SFDC_TAXONOMY, isCanonicalPair, taxonomyForReportPrompt } from "@/lib/sfdcTaxonomy";

const MAX_ROWS = 80;

// Second opinion on Type/Subtype for EA Activity rows, using the detailed
// taxonomy (descriptions, tiebreakers, examples) that note-time
// classification never sees. Returns suggestions only — the CSM decides
// whether to apply them.
export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { rows = [], replacements = [], corrections = [], apiKey, model } = body;
    if (!rows.length) {
      return new Response(JSON.stringify({ error: "rows are required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({ error: "Anthropic API key is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const clean = (t) => applyReplacements(applyCorrections(String(t || ""), corrections), replacements);
    const listed = rows.slice(0, MAX_ROWS).map((r, i) => ({
      index: i,
      title: clean(r.title),
      type: String(r.type || ""),
      subtype: String(r.subtype || ""),
      comments: clean(r.comments).slice(0, 900),
    }));

    const prompt = `You are auditing the Type/Subtype classification of EA Engagement Activity rows for a Salesforce report. Each row was classified earlier from the meeting itself; you see only its title and comment. Re-evaluate every row against the full taxonomy below, applying the same definitions and tiebreakers:

- EA Admin = a customer-side administrator, never an NI employee. NI-only sessions (CSM/FAE/AM) are Internal Alignment & Collaboration.
- NI-led demo sessions = User Groups / Demo Days; customer-run recurring groups = User Groups / User Group.
- Emails announcing releases, training, events, or entitlements to customer contacts = Entitlement Awareness & Promotion (Digital Campaign/Promotion, Newsletters, Training/Support Plans...).
- A customer-side person asking for help activating/using entitlements is Strategic Relationship Management (EA Admin Sync if they are the EA Admin, else Other), not Onboarding — Onboarding is a deliberate onboarding/kick-off session.
- Internal requests to line up presenters or plan a customer session = Internal Alignment & Collaboration / Account Planning (or User Groups / Other when planning a user group), not Account Team Kick-Off.
- Strategic Relationship Management is the catch-all for customer-facing work only after the more specific types are ruled out.

${taxonomyForReportPrompt()}

ROWS:
${JSON.stringify(listed, null, 1)}

OUTPUT — one JSON object per line (NDJSON), no other text, ONLY for rows where a different Type/Subtype pair is clearly better:
{"index":0,"type":"<exact Type>","subtype":"<exact Subtype>","reason":"one short sentence"}
Copy Type and Subtype text exactly from the taxonomy. If every row is already right, output exactly: {"index":-1}`;

    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: model || FAST_MODEL,
      max_tokens: 3000,
      system: "You classify customer-success activities precisely against a fixed taxonomy. Respond with only NDJSON.",
      messages: [{ role: "user", content: prompt }],
    });

    const suggestions = [];
    for (const line of firstTextBlock(msg).split("\n")) {
      const trimmed = line.trim().replace(/^```(json)?|```$/g, "").trim();
      if (!trimmed.startsWith("{")) continue;
      let obj;
      try { obj = JSON.parse(trimmed); } catch { continue; }
      if (!Number.isInteger(obj.index) || obj.index < 0 || obj.index >= listed.length) continue;
      const type = SFDC_TAXONOMY.find((t) => t.type === obj.type)?.type;
      if (!type || !isCanonicalPair(type, obj.subtype)) continue;
      const current = listed[obj.index];
      if (current.type === type && current.subtype === obj.subtype) continue;
      suggestions.push({
        index: obj.index,
        type,
        subtype: obj.subtype,
        // Reason comes back in pseudonym space; the client reverses it.
        reason: String(obj.reason || "").slice(0, 200),
      });
    }

    return new Response(JSON.stringify({ suggestions, usage: msg.usage, model: model || FAST_MODEL }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Classification check failed" }), { status: error?.status || 500, headers: { "Content-Type": "application/json" } });
  }
}
