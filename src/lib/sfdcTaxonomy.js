// The one Salesforce EA-engagement taxonomy every SFDC-bound prompt uses:
// the New Note and email-thread SFDC Activity Entry, and the EA Activity
// report. Strings are the exact SFDC picklist values. Notes written before
// the taxonomies were unified carry older spellings; normalizeSfdcType /
// normalizeSfdcSubtype map those onto the canonical values.

export const SFDC_TAXONOMY = [
  {
    type: "Entitlement Awareness & Promotion",
    description: "activities promoting awareness or use of EA entitlements",
    subtypes: [
      { name: "Digital Campaign/Promotion", description: "email/digital outreach campaigns promoting training, events, or EA awareness (e.g. NI Connect promo emails, training registration drives, event promotions)", example: "Launched NI Connect promotional email campaign to NGC contacts, targeting registration and identifying potential presenters for the NGC-sponsored session. Campaign supports expansion positioning." },
      { name: "MidTerm Reviews", description: "formal midpoint EA review with the customer covering usage and ROI" },
      { name: "Newsletters", description: "quarterly newsletters to account contacts covering product highlights, events, training, key POCs", example: "Distributed Q1 FY26 EA Quarterly Newsletter to Beacon Systems contacts. Content included NI product highlights, NI Connect event promotion, Beacon-specific upcoming events, training resources, and key NI POC information. Reinforced EA value awareness." },
      { name: "Shared Space Set-up/Update", description: "setting up or updating a shared portal or resource hub" },
      { name: "Training/Support Plans", description: "creating or scheduling a formal training plan across sites/teams", example: "Sync with Jordan (GTS, Acme Aerospace), Priya, and Marcus (NI Education Services) to scope LabVIEW Core 1 and Core 2 training across Acme sites. Acme holds ~7,600 EA training credits over 3 years. Confirmed in-person, instructor-led format." },
      { name: "Training/Support Webinar", description: "delivering a live training or support session to users" },
      { name: "Other" },
    ],
  },
  {
    type: "Internal Alignment & Collaboration",
    description: "NI-internal sessions (no customer present). Only log if a clear decision or outcome resulted",
    subtypes: [
      { name: "Account Planning", description: "CSM/FAE interlock, account strategy sessions, NI Connect planning calls, internal alignment that produced a defined outcome", example: "CSM/FAE FY26 account interlock for Cardinal Defense. Reviewed CS focus areas, current usage data trends, and CS execution plan including site-level priorities. Identified specific gaps in FAE workflow where CSM provides strategic coverage." },
      { name: "Account Team Kick-Off", description: "formal kickoff session with the full internal account team (CSM, FAE, AM, etc.)", example: "CSM/FAE Interlock for FY 2026, reviewing CS Focus Areas, overview of usage data trends, CS execution plans including site level and event calendar, and brainstorming session on where CS can help fill in gaps in the FAE workflow." },
      { name: "Product Feedback", description: "internal session to escalate or document customer product feedback" },
      { name: "Other", description: "recurring internal team syncs (e.g. biweekly account team calls) when they produced a concrete outcome" },
    ],
  },
  {
    type: "Onboarding & Kick-Off",
    description: "onboarding new admins or users",
    subtypes: [
      { name: "EA Admin Onboarding", description: "onboarding a new customer-side EA Admin (customer IT administrator who runs the EA or maintains NI licensing for their company) to EA scope, entitlements, and governance. This is always a customer-facing meeting.", example: "EA Admin onboarding session for two new Beacon Systems EA Admins who recently took over the role. Session covered the full scope of the EA (software entitlements, training credits, etc.), admin Q&A, and established understanding of internal processes." },
      { name: "EA End-User Kick-Off", description: "introduction or review of EA terms, entitlements, and inclusions with customer end users" },
      { name: "Other" },
    ],
  },
  {
    type: "Strategic Relationship Management",
    description: "high-touch customer-facing relationship and governance activities",
    subtypes: [
      { name: "EA Admin Sync", description: "recurring or ad-hoc sync with the customer-side EA Admin (customer IT administrator who runs the EA or maintains NI licensing for their company) or other key customer stakeholders. These contacts are NOT NI employees.", example: "Delta Microsystems TestStand Pilot Check In and EA Renewal Alignment — Meeting with the EA Admin to review pilot status and align on renewal timeline." },
      { name: "Escalation/Risk Management", description: "active risk mitigation, escalations, or at-risk situations", example: "Active R&D escalation on behalf of a test engineer at Cardinal Defense related to an IVI driver issue preventing LabVIEW control of a bench oscilloscope. Original FAE ticket stalled after R&D contacts left NI. CSM submitted an R&D Advocacy request to unblock." },
      { name: "QBRs/EBRs", description: "formal quarterly or executive business review" },
      { name: "Roadmap Review", description: "session reviewing NI product roadmap with customer stakeholders" },
      { name: "SLE Governance", description: "SystemLink Enterprise governance meetings" },
      { name: "Other" },
    ],
  },
  {
    type: "User Groups",
    description: "group sessions with multiple attendees. Pick subtype based on who led the session",
    subtypes: [
      { name: "Demo Days", description: "NI-led session where NI/FAE presents or demos products to the customer", format: "[Title] — Region: [X], Attendees: [#]. [Description of session content and who led it.] Outcome: [adoption / expansion / risk reduction / customer momentum]", example: "Beacon Systems RF User Group — Region: AMER, Attendees: 22. FAE and AM led users through an overview of NI RF Hardware Platforms and demoed InstrumentStudio. Session targeted RF-focused sites. Outcome: Drove direct product exposure across the RF engineering community and generated adoption momentum at targeted sites." },
      { name: "User Group", description: "customer-sponsored recurring session; may include NI content but customer drives cadence/agenda", format: "[Title] — Region: [X], Attendees: [#]. [Description]. Outcome: [impact]", example: "LMS User Group — Region: AMER, Participants: TBD. Conducted an LMS user group session focused on important updates to the LMS NI EA and entitlements. Maintained customer momentum and reinforced awareness of EA value." },
      { name: "Other", description: "planning or brainstorming sessions tied to user group execution (e.g. pre-UG sponsor sync)" },
    ],
    note: "NI-led demo sessions = Demo Days. Customer-sponsored recurring groups = User Group. Pre-UG planning calls = Other.",
  },
  {
    type: "Value Realization & Success Stories",
    description: "capturing or communicating customer outcomes and ROI",
    subtypes: [
      { name: "Case Study", description: "written or formal case study in progress or completed", example: "Initiated SystemLink case study with the IT Admin Lead at Beacon Systems documenting the successful deployment of SystemLink Server at their Florida sites. Sessions held 3/11 and 3/12 to capture deployment scope, outcomes, and measurable value." },
      { name: "Customer Testimonial", description: "capturing a customer success quote or formal testimonial" },
      { name: "Outcome Review", description: "reviewing measured outcomes and value delivered" },
      { name: "SLE ROI Review", description: "formal ROI review specific to SystemLink Enterprise" },
      { name: "Other" },
    ],
  },
  {
    type: "Other",
    description: "only use if truly none of the above types fit",
    subtypes: [{ name: "Other" }],
  },
];

// Older spellings (from the pre-unification New Note prompt) → canonical.
const TYPE_ALIASES = {
  "training or support webinar": "Entitlement Awareness & Promotion",
  "internal alignment and collaboration": "Internal Alignment & Collaboration",
  "onboarding & kick-off": "Onboarding & Kick-Off",
  "onboarding and kick-off": "Onboarding & Kick-Off",
  "value realization and success stories": "Value Realization & Success Stories",
};

const SUBTYPE_ALIASES = {
  "account team kickoff": "Account Team Kick-Off",
  "ea end-user kick-off": "EA End-User Kick-Off",
  "ea end-user kickoff": "EA End-User Kick-Off",
  "escalation / risk management": "Escalation/Risk Management",
  "qbr / ebr": "QBRs/EBRs",
  "qbr/ebr": "QBRs/EBRs",
  "product roadmap review": "Roadmap Review",
  "systemlink enterprise governance": "SLE Governance",
  "demo day": "Demo Days",
  "systemlink roi review": "SLE ROI Review",
  "training or support webinar": "Training/Support Webinar",
};

const key = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

export function normalizeSfdcType(type) {
  const k = key(type);
  if (!k) return "";
  const canonical = SFDC_TAXONOMY.find((t) => key(t.type) === k);
  if (canonical) return canonical.type;
  return TYPE_ALIASES[k] || String(type).trim();
}

export function normalizeSfdcSubtype(type, subtype) {
  const canonicalType = normalizeSfdcType(type);
  const entry = SFDC_TAXONOMY.find((t) => t.type === canonicalType);
  const k = key(subtype);
  // Legacy "Training or Support Webinar: Other" meant the webinar itself.
  if (key(type) === "training or support webinar" && (!k || k === "other")) return "Training/Support Webinar";
  if (!k) return entry ? "Other" : "";
  const aliased = SUBTYPE_ALIASES[k] || String(subtype).trim();
  if (!entry) return aliased;
  const match = entry.subtypes.find((s) => key(s.name) === key(aliased));
  return match ? match.name : aliased;
}

export function isCanonicalPair(type, subtype) {
  const entry = SFDC_TAXONOMY.find((t) => t.type === type);
  return !!entry && entry.subtypes.some((s) => s.name === subtype);
}

// Compact "Type → Subtypes" list for the note-generation prompts.
export function taxonomyForNotePrompt() {
  return SFDC_TAXONOMY
    .map((t) => `- ${t.type} → ${t.subtypes.map((s) => s.name).join("; ")}`)
    .join("\n");
}

// Full descriptions, formats, and examples for the EA Activity report prompt.
export function taxonomyForReportPrompt() {
  return SFDC_TAXONOMY.map((t) => {
    const lines = [`**Type: ${t.type}** — ${t.description}:`];
    for (const s of t.subtypes) {
      lines.push(`  - ${s.name}${s.description ? ` — ${s.description}` : ""}`);
      if (s.format) lines.push(`    Comment format: "${s.format}"`);
      if (s.example) lines.push(`    Example: "${s.example}"`);
    }
    if (t.note) lines.push(`  ⚠️ ${t.note}`);
    return lines.join("\n");
  }).join("\n\n");
}
