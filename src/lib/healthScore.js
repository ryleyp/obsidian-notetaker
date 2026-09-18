// The pillars, the colour words and the note layer all come from one module,
// so a scorecard cannot end up rating pillars the notes never captured.
import { HEALTH_COLOURS, HEALTH_PILLARS as PILLARS, HEALTH_TRENDS } from "./healthSession";

function otherAccountRules(accountName, allAccounts) {
  const others = (allAccounts || []).filter(
    (account) => account.name && account.name !== accountName && account.name !== "Internal"
  );
  if (!others.length) return "";
  const labels = others.map((account) => {
    const terms = [account.name, ...(account.aliases || []), ...(account.keywords || [])]
      .filter(Boolean)
      .join(", ");
    return `- ${terms}`;
  });
  return `\nThe following names and identifiers belong to other accounts. Never use them or facts tied to them:\n${labels.join("\n")}\n`;
}

export function buildHealthScorePrompt({
  notes,
  accountName,
  allAccounts = [],
  today,
  previousDeckText = "",
  previousDeckName = "",
  reviewTranscriptFilename = "",
  rangeStart = "",
  rangeEnd = "",
}) {
  const account = accountName && accountName !== "Internal" ? accountName : "";
  if (!account) throw Object.assign(new Error("Choose a folder that maps to a configured account."), { status: 400 });

  const sourceBlocks = notes.map((note) => {
    const reviewLabel = note.filename === reviewTranscriptFilename ? " [SELECTED PRIOR REVIEW TRANSCRIPT]" : "";
    return `### ${note.date || "Undated"} — ${note.title}${reviewLabel}\n\n${note.content}`;
  }).join("\n\n---\n\n");

  const priorDeck = previousDeckText.trim()
    ? `\n---\nPRIOR SCORECARD PDF: ${previousDeckName || "Uploaded prior scorecard"}\n\n${previousDeckText}\n\nUse this only to identify the last-shared ratings, open commitments, slide sequence, and wording continuity for ${account}. Treat every factual statement in it as historical and unverified until a dated current source corroborates it. Ignore every section about another account.\n`
    : "\nNo prior scorecard PDF was supplied. State that prior ratings and commitments could not be compared.\n";

  return `Create a slide-ready Customer Success health score for ${account} only, as of ${today}.

ACCOUNT ISOLATION IS ABSOLUTE:
- Use only the source notes provided from the selected ${account} folder.
- Never mention, compare, benchmark, or borrow facts from another customer.
- If a source passage is not clearly attributable to ${account}, omit it.
- The prior PDF is historical context, not proof of a current fact.
- A selected prior-review transcript may clarify what was presented, challenged, or agreed, but it does not override newer dated evidence.
${otherAccountRules(account, allAccounts)}
EVIDENCE RULES:
- Select facts by the date in the note title or source heading, within ${rangeStart || "the selected start date"} through ${rangeEnd || today}.
- Separate observed facts, attributed account-team reports, Customer Success judgment, recommended action, and unknowns.
- Do not invent usage, financial, renewal, contact, product, or telemetry details.
- Rate Adoption from supplied usage evidence when it exists. If it does not, mark the rating provisional and name the missing evidence.
- Newer dated evidence overrides older evidence. Keep material conflicts unresolved and label them for verification.
- Treat the prior deck and review transcript as continuity sources. Verify current claims against dated folder notes.
- Where a note carries a "Health Ratings Captured" table, those are the colours that were actually stated in that session, with who set them and whether they moved. Treat a row marked Proposed or Disputed as not yet agreed, and a row marked "Not discussed" as no evidence rather than a Green.
- Where a note carries "Scorecard Feedback", that is coaching about the deck. Apply it to how this scorecard is written; never report it as a fact about the account.
- Where a note separates work the CSM led from work relayed from the account team, keep that separation in the assessment. Claiming the account team's work is as wrong as relaying it with no attribution.
- Name the source and its blind spot whenever usage is cited, and say from when. When two sources disagree on direction, give both and say which has been steadier.

RATING RUBRIC:
- Proficiency & Self Service: Green means formal plans, named owners, and customer-led enablement across active areas. Yellow means partial plans or NI remains the forcing function. Red means no plan, no owner, or enablement capacity is going unused.
- Adoption: Green means live, growing deployments with sponsor confirmation. Yellow means stagnant, unknown, concentrated, gated, or incomplete data. Red means shrinking, stalled, or active displacement.
- Sponsors & End Users: Green means direct, multi-threaded Customer Success relationships. Yellow means a key relationship or site is single-threaded or indirect. Red means no direct sponsor relationship in a major area.
- Expansion: Green means named, funded software opportunities are moving. Yellow means opportunities depend on product, IT, budget, or one contact. Red means expansion is blocked or has reached a ceiling.
- Renewal: Green means renewed or more than 12 months out with onboarding established. Yellow means inside 12 months or under migration, downsell, or pricing pressure. Red means the renewal is at risk.
- Overall health uses judgment but cannot be better than a Red pillar. Use ${HEALTH_COLOURS.join(", ")}.
- Trend is one of ${HEALTH_TRENDS.join(", ")}. Flat is a measurement, not a hedge: say what the data shows and from when.

WRITING RULES:
- Write for sales and Customer Success leadership in direct, professional language.
- Lead with the business meaning, then the evidence and what Customer Success is driving.
- Recommended actions state outcomes, dependencies, and purpose. Keep scheduling details out of the action headline.
- Give up to three credible priority commitments. Do not invent filler to reach three.
- Use exact dates, names, quantities, products, and sites when they materially support a Yellow or Red assessment.
- Avoid em dashes, slogans, vague status language, and unsupported causal claims.

Return Markdown only, using exactly this structure:

# ${account} Customer Success Health

**As of:** ${today}  
**Evidence window:** ${rangeStart || "Selected range"} to ${rangeEnd || today}  
**Prior scorecard:** ${previousDeckText.trim() ? previousDeckName || "Included" : "Not provided"}  
**Prior review transcript:** ${reviewTranscriptFilename || "Not selected"}

## Executive Summary

[Current foundation, growth signal, why health is not higher, and what Customer Success is driving.]

**Overall Health:** [Green / Yellow / Red / Unknown]  
**Trend Since Last Review:** [${HEALTH_TRENDS.join(" / ")}]  
**Confidence:** [High / Medium / Low, with one-sentence reason]

## Health Scorecard

| Pillar | Assessment | Health | Recommended Customer Success Actions |
| --- | --- | --- | --- |
${PILLARS.map((pillar) => `| ${pillar} | [Evidence-based assessment and what would change the rating] | [Green / Yellow / Red / Unknown] | [Outcome-focused action, owner or dependency when known] |`).join("\n")}

## Since Last Review

- **[Prior commitment]** → [Done / In progress / Blocked / Dropped, with the dated evidence]
- [Prior rating or claim] → [current evidence-based status and dated source]
- If no prior scorecard was supplied, write: Prior scorecard not provided; continuity could not be assessed.

Leadership opens these reviews on the previous quarter's commitments, so this section comes before the detail and states each one's status plainly.

## Priority Commitments

1. **[Credible Customer Success outcome]** — [why it matters and dependency]
2. **[Credible Customer Success outcome]** — [why it matters and dependency]
3. **[Only include if supported]** — [why it matters and dependency]

## Support Needed

| Priority | Leadership Support Needed | NI Owner | By When | Intended Outcome |
| --- | --- | --- | --- | --- |
| [Strategic issue] | [Decision, access, or organizational unblock] | [Known owner or TBD] | [Date or TBD] | [Specific change expected] |

## Evidence And Open Questions

- **[YYYY-MM-DD, source title]** — [fact and which rating it supports]
- **Needs verification:** [conflict, missing telemetry, missing contact, or unsupported prior-deck claim]

## Suggested Slide Sequence

1. **${account} Customer Success Health** — Overall score, trend, executive summary, and the main focus labels.
2. **Proficiency And Adoption** — The first two scorecard rows with dated evidence and actions.
3. **Sponsors, Expansion And Renewal** — The remaining scorecard rows with dated evidence and actions.
4. **Support Needed** — Decisions, access, and organizational help required.

---
SELECTED FOLDER SOURCES:

${sourceBlocks}
${priorDeck}`;
}

