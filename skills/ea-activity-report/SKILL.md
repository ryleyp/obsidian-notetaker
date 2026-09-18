---
name: ea-activity-report
description: Write, classify, review, and clean up NI Software EA engagement activity records for Salesforce from meeting notes, transcripts, voice memos, or email threads. Use whenever the user asks for an EA activity report, SFDC activity entries, activity logging or logging catch-up, quarter-end activity hygiene, help picking a Type/Subtype, a rewrite of an activity comment that is too long or reads badly, or a portfolio review of what has been logged for an account — even if they do not say "EA" or name Salesforce. Also use it for notes from a customer health scorecard session, which carry their own sections and checks.
---

# EA engagement activity reporting

Produce activity records a reader can understand without the original notes: the customer
context, the work performed, the CSM's own contribution, the result, and the next action.

The authoritative taxonomy and the full quality checklist live in this skill:

- `reference/taxonomy.md` — every Type and Subtype, with the classification process,
  tiebreakers, the writing contract, and real filed examples. **Read it before
  classifying anything.** Copy Type and Subtype character-for-character.
- `reference/quality-checks.md` — every check a record must pass, what each one catches,
  and how to resolve it.
- `reference/health-sessions.md` — the extra sections a health scorecard session's note
  carries, and the checks on them. **Read it whenever the source notes are from a health
  review, an account-manager pre-sync, scorecard coaching, or a portfolio roll-up.**

Both are generated from the notetaker app's own source, so they always match what the app
enforces. If the taxonomy looks wrong, fix `src/lib/sfdcTaxonomy.js` in
`~/Documents/Claude Code/obsidian-notetaker` and run `npm run skill` — never hand-edit the
reference files.

## Ground rules

- **Never invent a fact.** Not an attendee, a region, an attendance count, an outcome, a
  title, or a number. An unknown attendee count is "TBD". Missing outcomes are
  "Outcomes: None stated" in a note, and simply absent in Salesforce.
- **Confirmed and expected are different things.** "The customer named the pilot site" is
  an outcome. "The pilot should validate the deployment model" is expected impact and is
  labelled as expected.
- **Never claim revenue causation** — no "drove renewal", "generated expansion", "secured
  the deal" — unless a source says exactly that.
- **Never claim the account team's work as the CSM's.** When the FAE or AM led, say so and
  state the CSM's own part. When the CSM genuinely did nothing beyond being in the room,
  write "Contribution: None beyond attendance" rather than inventing one.
- **Never write that the CSM attended, observed, or listened.** Describe the meeting and
  who led it, and leave the CSM's presence unmentioned.
- The comment is pasted into Salesforce verbatim: third person, past tense, no Markdown,
  no bullets, no source markers like `[T1]`, the CSM referred to as "CSM" and never by name.

## What counts as one activity

- One record per meaningful engagement or completed body of work. Scheduling mail, replies,
  and routine coordination belong inside the engagement they serve, not in records of their own.
- Each occurrence of a recurring engagement (monthly sponsor sync, quarterly user group) is
  its own record.
- One substantive conversation stays one record even when it covers several themes. Never
  reduce a broad strategic conversation to its easiest administrative topic.
- Split only when the sources describe genuinely separate engagements, audiences, dates, or
  outcomes.
- Internal-only work is reportable only when it produced a decision, a plan, an escalation
  path, an ownership change, or a customer-facing consequence.
- Not reportable at all: manager 1:1s, team or staff meetings, career or scorecard
  conversations, training the CSM took themselves, and anything not about this account's EA.
  Say so explicitly rather than silently dropping it.
- An outcome is not an extra activity. Describe it inside the activity that produced it.

## Writing one record

**Activity Title** — names the engagement *and its purpose*. "Engineering sponsor sync on
adoption blockers and Q3 rollout timing" beats "Sponsor sync". Never a file name or a mail
subject: no leading date, no `RE:`/`FW:`, no `Email -`.

**Comment** — four labelled parts, in this order, as plain sentences on one line:

```
Summary: who took part (customer contacts by name with title, NI colleagues by role), what
customer need, initiative, risk, or account objective drove it, and what was covered.
Contribution: what the CSM personally did, opening with a real verb — defined, coordinated,
advised, resolved, escalated, mapped, validated, introduced, documented, secured.
Outcomes: what was confirmed. Label anything expected as expected.
Next steps: the CSM's own next actions, with owner and date when stated.
```

Budget the 800 characters across all four. When it is tight, cut detail from Summary first —
Contribution and Outcomes are what a reviewer is looking for.

## Output

Default to the SFDC-ready block, one per activity:

```
**Activity Title:** ...
**Type:** ...
**Subtype:** ...
**EA/EP Number(s):** ... (or "None on file")
**Reportable:** Yes | No — reason
**Date:** YYYY-MM-DD

**Summary/Notes:**
Summary: ...
Contribution: ...
Outcomes: ...
Next steps: ...
```

When the user asks for a table, or for several activities across a range, emit one row per
activity with: Event Date, Activity Title, Type, Subtype, EA/EP, Source Note, Comment.
Keep rows newest first and cite the source note for every row.

After the records, list: any facts that need human confirmation, and any row where the
classification was a genuine toss-up, with the two candidates and why.

## Reviewing records the user already has

Preserve the original, then give: the revised record, a short list of material corrections
(category, unsupported claim, missing outcome, stale status, missing next step), and the
facts that need confirmation. Run every check in `reference/quality-checks.md`.

## Reviewing a whole period

When looking at a set of records rather than one, also report the shape of the portfolio:

- Customer-facing versus internal mix — more than about a third internal reads as thin coverage.
- Over-concentration in one category, when other real work probably went unlogged.
- Repeated `Other` — usually a misclassification, sometimes a real taxonomy gap worth raising.
- Duplicate titles on the same date, and recurring engagements collapsed into one record.
- Inconsistent or missing EA/EP identifiers, which fragment reporting.
- Long stretches with nothing logged, especially near a renewal or during a change.

Never manufacture category variety for appearance, and never recommend more engagement
unless the account's needs, lifecycle stage, or a documented coverage gap calls for it.

## Health scorecard sessions

A meeting about account health itself (a leadership health review, a pre-sync with the
account manager, scorecard coaching, a portfolio roll-up) produces two separate things, and
mixing them is the usual failure:

- **The note** carries extra sections: the colour of every pillar with who set it and why,
  feedback on the deck kept apart from facts about the account, the questions leadership
  asked, every usage figure with its source, what the CSM led as against relayed, the
  commitments due at the next review, the support asks, and any other customer raised as a
  precedent. `reference/health-sessions.md` has each section in full, plus the checks a
  saved note has to pass. The quarterly scorecard is built from these sections months later,
  so a colour or a commitment that is not written down is gone.
- **The activity record** follows the ordinary rules. These sessions are internal work, so
  they are reportable only when they produced a decision, an escalation, or an ownership
  change, and a manager one-to-one about the scorecard is not reportable at all. Never put
  ratings, coaching, or reviewer names in a Salesforce comment.

Two things go wrong often enough to check for by name: a session's own colours recorded as
narrative instead of per pillar, and another account's precedent filed as a fact about this
one.

## The app that already does this

`~/Documents/Claude Code/obsidian-notetaker` generates these entries inside meeting notes and
builds the quarterly report from an Obsidian vault, with the same taxonomy and checks wired in.
If the user wants a whole quarter from their vault, point them at the EA Activity tab — it
harvests the entry each note already carries, so most rows need no model at all. Use this
skill for work outside that loop: pasted notes, a one-off record, a rewrite, or a review.
