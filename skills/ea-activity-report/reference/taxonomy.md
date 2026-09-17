# EA engagement taxonomy

<!-- Generated from src/lib by `npm run skill`. Edit the source, not this file. -->

Type and Subtype are Salesforce picklist values. Copy them character-for-character;
a near-miss spelling cannot be filed.

## Choosing a type

IMPORTANT DEFINITION — EA Admin: a customer-side IT administrator (employed by the customer account, not by NI) who runs the EA or maintains NI licensing on their company's behalf. EA Admins are NOT NI employees. Any meeting with an EA Admin is customer-facing — never Internal Alignment.
NI-side roles are NOT EA Admins: AMs (Account Managers), FAEs (Field Application Engineers), CSMs, and any other NI employee. A meeting attended only by NI-side roles (a CSM/FAE or CSM/AM sync with no customer contact present) is Internal Alignment & Collaboration, NOT an EA Admin Sync.

CLASSIFICATION PROCESS — evaluate ALL six types before choosing; do not stop at the first plausible one:
1. Entitlement Awareness & Promotion — promoting EA entitlement awareness or usage (emails, newsletters, training plans, shared portals, live training sessions)
2. Internal Alignment & Collaboration — NI-internal only, NO customer present, and a concrete decision or outcome resulted (no outcome → not reportable)
3. Onboarding & Kick-Off — deliberately onboarding a new customer-side EA Admin or new end users to the EA scope and entitlements
4. Strategic Relationship Management — a customer-facing governance or relationship sync that is not a User Group or Onboarding
5. User Groups — a group session with multiple attendees (demo, user group, or the planning for one)
6. Value Realization & Success Stories — the primary purpose was capturing or communicating ROI, outcomes, or a success story

TIEBREAKERS:
- NI-internal only (zero customer contacts) → Internal Alignment & Collaboration, never Strategic
- Group session with multiple attendees → User Groups, not Strategic. NI-led demo = Demo Days; customer-run recurring group = User Group; planning a user group = Other
- A live training or support session delivered to users → Entitlement Awareness & Promotion / Training/Support Webinar
- Onboarding a new EA Admin or new end users → Onboarding & Kick-Off. A customer contact merely asking for help activating or using an entitlement is Strategic Relationship Management (EA Admin Sync if they are the EA Admin, else Other), not Onboarding
- Capturing or writing ROI or a success story → Value Realization
- Risk or escalation as the reason for the meeting → Escalation/Risk Management over a routine sync
- Classify by the meeting's primary purpose, not a topic that merely came up; if still tied, pick the type reflecting the strategic outcome
- Strategic Relationship Management is the catch-all for customer-facing work only after every more specific type is ruled out
Before writing the row, ask once more: "Is there a more specific type that fits better than what I am about to pick?"

## Writing the record

WHAT COUNTS AS ONE ACTIVITY
- One record per meaningful engagement or completed body of work, and at most one record per source note. A meeting note or an email thread produces one activity, never two. Scheduling mail, replies, and routine coordination are part of the engagement they serve, not activities of their own.
- Each occurrence of a recurring engagement (monthly sponsor sync, quarterly user group) is its own record.
- One substantive conversation stays one record even when it covers several themes. Never reduce a broad strategic conversation to its easiest administrative topic — if a meeting covered adoption, an escalation, licensing, and enablement, the summary shows that breadth.
- Split into separate records only when the sources describe genuinely separate engagements, audiences, dates, or outcomes.
- Internal-only work is reportable only when it produced a decision, a plan, an escalation path, an ownership change, or a customer-facing consequence.
- An outcome is not an extra activity. Describe it inside the activity that produced it.

THE THREE LABELLED PARTS — write each one, in this order, as plain sentences:
- Summary: who took part (customer contacts by name with title or role when the sources give it, NI colleagues by role), what customer need, initiative, risk, or account objective drove the engagement, what was actually discussed or delivered, and what the CSM did about it. The CSM's own work belongs in this sentence, carried by a real verb — defined, coordinated, advised, resolved, escalated, mapped, validated, introduced, documented, secured, drove, scoped — not as a separate labelled line. "Attended", "joined", and "was present" are not work: when the FAE or AM led, say so and state the CSM's own part; when the sources show the CSM did nothing beyond being in the room, describe the meeting and leave their part unmentioned rather than inventing one.
- Outcomes: what was actually confirmed — decisions, findings, customer feedback, risks, blockers. Keep confirmed results separate from intended ones: "the customer named the pilot site" is an outcome; "the pilot should validate the deployment model" is expected impact and is labelled as expected. "Outcomes: None stated" when the sources confirm nothing.
- Next steps: the CSM's own next actions with owner and date when stated, plus any dependency or unresolved question that materially affects progress. "Next steps: None" when there are none.

STATUS, RECURRENCE, AND EVIDENCE
- A record describes what actually happened. "Planned" is only for a real future commitment; never give a planned record attendance, outcomes, or customer feedback it cannot have yet. Once it happens, update the date, participants, category, result, and next steps, and mark it completed. Something that did not happen is canceled with a short reason — never left sitting in planned after the period closes.
- Each occurrence of a recurring engagement is its own record with that occurrence's own participants, discussion, and outcome. Never keep one rolling record for a whole series.
- A user group or event is updated with its actual final attendance once it has happened; "TBD" is honest beforehand and wrong afterwards.
- Positive customer feedback is worth recording even with no numbers attached — keep the person's role, what they were reacting to, and the product or experience involved, so it can support a case study or account review later.
- The source note is the record's evidence. Cite the note the activity came from so anyone reviewing it can get back to the decks, mail, and attendance behind it.

HONESTY RULES
- Tie an activity to adoption, proficiency, retention, expansion, or risk reduction only where the sources support that link. Never assert revenue causation — no "drove renewal", "generated expansion", "secured the deal" unless a source says exactly that.
- Never state attendance, regions, outcomes, or titles the sources do not give. "TBD" is the honest answer for an unknown attendee count.
- Avoid the "Other" subtype when a specific one fits; reach for "Other" only when nothing else genuinely applies.

## The types

### Entitlement Awareness & Promotion

activities promoting awareness or use of EA entitlements.

- **Digital Campaign/Promotion** — email/digital outreach campaigns promoting training, events, or EA awareness (e.g. NI Connect promo emails, training registration drives, event promotions)
  - Example: Launched NI Connect promotional email campaign to NGC contacts, targeting registration and identifying potential presenters for the NGC-sponsored session. Campaign supports expansion positioning.
- **MidTerm Reviews** — formal midpoint EA review with the customer covering usage and ROI
- **Newsletters** — quarterly newsletters to account contacts covering product highlights, events, training, key POCs
  - Example: Distributed Q1 FY26 EA Quarterly Newsletter to Beacon Systems contacts. Content included NI product highlights, NI Connect event promotion, Beacon-specific upcoming events, training resources, and key NI POC information. Reinforced EA value awareness.
- **Shared Space Set-up/Update** — setting up or updating a shared portal or resource hub
- **Training/Support Plans** — creating or scheduling a formal training plan across sites/teams
  - Example: Sync with Jordan (GTS, Acme Aerospace), Priya, and Marcus (NI Education Services) to scope LabVIEW Core 1 and Core 2 training across Acme sites. Acme holds ~7,600 EA training credits over 3 years. Confirmed in-person, instructor-led format.
- **Training/Support Webinar** — delivering a live training or support session to users
- **Other**

### Internal Alignment & Collaboration

NI-internal sessions (no customer present). Only log if a clear decision or outcome resulted.

- **Account Planning** — CSM/FAE interlock, account strategy sessions, NI Connect planning calls, internal alignment that produced a defined outcome
  - Example: CSM/FAE FY26 account interlock for Cardinal Defense. Reviewed CS focus areas, current usage data trends, and CS execution plan including site-level priorities. Identified specific gaps in FAE workflow where CSM provides strategic coverage.
- **Account Team Kick-Off** — formal kickoff session with the full internal account team (CSM, FAE, AM, etc.)
  - Example: CSM/FAE Interlock for FY 2026, reviewing CS Focus Areas, overview of usage data trends, CS execution plans including site level and event calendar, and brainstorming session on where CS can help fill in gaps in the FAE workflow.
- **Product Feedback** — internal session to escalate or document customer product feedback
- **Other** — recurring internal team syncs (e.g. biweekly account team calls) when they produced a concrete outcome

### Onboarding & Kick-Off

onboarding new admins or users.

- **EA Admin Onboarding** — onboarding a new customer-side EA Admin (customer IT administrator who runs the EA or maintains NI licensing for their company) to EA scope, entitlements, and governance. This is always a customer-facing meeting.
  - Example: EA Admin onboarding session for two new Beacon Systems EA Admins who recently took over the role. Session covered the full scope of the EA (software entitlements, training credits, etc.), admin Q&A, and established understanding of internal processes.
- **EA End-User Kick-Off** — introduction or review of EA terms, entitlements, and inclusions with customer end users
- **Other**

### Strategic Relationship Management

high-touch customer-facing relationship and governance activities.

- **EA Admin Sync** — recurring or ad-hoc sync with the customer-side EA Admin (customer IT administrator who runs the EA or maintains NI licensing for their company) or other key customer stakeholders. These contacts are NOT NI employees.
  - Example: Delta Microsystems TestStand Pilot Check In and EA Renewal Alignment — Meeting with the EA Admin to review pilot status and align on renewal timeline.
- **Escalation/Risk Management** — active risk mitigation, escalations, or at-risk situations
  - Example: Active R&D escalation on behalf of a test engineer at Cardinal Defense related to an IVI driver issue preventing LabVIEW control of a bench oscilloscope. Original FAE ticket stalled after R&D contacts left NI. CSM submitted an R&D Advocacy request to unblock.
- **QBRs/EBRs** — formal quarterly or executive business review
- **Roadmap Review** — session reviewing NI product roadmap with customer stakeholders
- **SLE Governance** — SystemLink Enterprise governance meetings
- **Other**

### User Groups

group sessions with multiple attendees. Pick subtype based on who led the session.

- **Demo Days** — NI-led session where NI/FAE presents or demos products to the customer
  - Comment format: `[Title] — Region: [X], Attendees: [#]. [Description of session content and who led it.] Outcome: [adoption / expansion / risk reduction / customer momentum]`
  - Example: Beacon Systems RF User Group — Region: AMER, Attendees: 22. FAE and AM led users through an overview of NI RF Hardware Platforms and demoed InstrumentStudio. Session targeted RF-focused sites. Outcome: Drove direct product exposure across the RF engineering community and generated adoption momentum at targeted sites.
- **User Group** — customer-sponsored recurring session; may include NI content but customer drives cadence/agenda
  - Comment format: `[Title] — Region: [X], Attendees: [#]. [Description]. Outcome: [impact]`
  - Example: LMS User Group — Region: AMER, Participants: TBD. Conducted an LMS user group session focused on important updates to the LMS NI EA and entitlements. Maintained customer momentum and reinforced awareness of EA value.
- **Other** — planning or brainstorming sessions tied to user group execution (e.g. pre-UG sponsor sync)

> NI-led demo sessions = Demo Days. Customer-sponsored recurring groups = User Group. Pre-UG planning calls = Other.

### Value Realization & Success Stories

capturing or communicating customer outcomes and ROI.

- **Case Study** — written or formal case study in progress or completed
  - Example: Initiated SystemLink case study with the IT Admin Lead at Beacon Systems documenting the successful deployment of SystemLink Server at their Florida sites. Sessions held 3/11 and 3/12 to capture deployment scope, outcomes, and measurable value.
- **Customer Testimonial** — capturing a customer success quote or formal testimonial
- **Outcome Review** — reviewing measured outcomes and value delivered
- **SLE ROI Review** — formal ROI review specific to SystemLink Enterprise
- **Other**

### Other

only use if truly none of the above types fit.

- **Other**
