# Health scorecard session notes

<!-- Generated from src/lib by `npm run skill`. Edit the source, not this file. -->

A health scorecard session is a meeting about account health itself: the colours,
the deck, the commitments. The app detects one from the meeting title, the CSM's
own context notes, and the transcript, and asks for extra sections in the note.
Those sections are what the quarterly scorecard is later built from, so this page
describes what each one has to contain.

Pillars: Proficiency & Self Service, Adoption, Sponsors & End Users, Expansion, Renewal. Colours: Green, Yellow, Red, Unknown. Trends: Improving, Flat, Declining, Unknown.

## The kinds of session

### Scorecard coaching

The CSM and their manager work the scorecard or its template. The output is feedback on the deck.

- Sections asked for: Health Ratings Captured, Scorecard Feedback, Led Versus Relayed, Commitments For Next Review, Cross-Account References, Verify Before Use.
- Sections a saved note must carry: Health Ratings Captured, Scorecard Feedback, Led Versus Relayed.

### Account manager pre-sync

The CSM walks the account manager through the deck before the leadership review so nothing lands as a surprise.

- Sections asked for: Health Ratings Captured, Scorecard Feedback, Leadership Questions Asked, Usage And Data Claims, Led Versus Relayed, Commitments For Next Review, Support Asks Raised, Cross-Account References, Verify Before Use.
- Sections a saved note must carry: Health Ratings Captured.

### Leadership health review

The CSM presents account health to sales and Customer Success leadership.

- Sections asked for: Health Ratings Captured, Scorecard Feedback, Leadership Questions Asked, Usage And Data Claims, Led Versus Relayed, Commitments For Next Review, Support Asks Raised, Cross-Account References, Verify Before Use.
- Sections a saved note must carry: Health Ratings Captured, Scorecard Feedback, Leadership Questions Asked, Usage And Data Claims, Led Versus Relayed, Commitments For Next Review, Support Asks Raised, Verify Before Use.

### Portfolio roll-up

A team session building a one-line health view across several accounts for an executive.

- Sections asked for: Health Ratings Captured, Usage And Data Claims, Cross-Account References, Verify Before Use.
- Sections a saved note must carry: Health Ratings Captured.

### Health scoring inside another meeting

A regular meeting where health scoring is one topic among several. The layer covers that topic only.

- Sections asked for: Health Ratings Captured, Scorecard Feedback, Verify Before Use.
- Sections a saved note must carry: none.

## The sections

### Health Ratings Captured

One row per account per pillar, as a table with these columns: Pillar | Colour | Said By | Changed On Call | Reason Given | Data Source Cited | Green If | Status.
- Cover every pillar: Proficiency & Self Service, Adoption, Sponsors & End Users, Expansion, Renewal, plus an Overall row. A pillar nobody discussed gets a row saying "Not discussed". Never drop the row, because a missing row and an undiscussed pillar mean different things to whoever reads this next.
- Colour is one of Green, Yellow, Red, Unknown. When someone says Amber, write Yellow and put their word in Reason Given.
- Changed On Call records a colour that moved during the session, as "Green to Yellow". Otherwise write "No".
- Status is Agreed, Proposed, or Disputed. A colour one person floated is Proposed.
- If a summary sentence for overall health was drafted or reworded live, quote the final version under the table.

### Scorecard Feedback

Feedback about the scorecard itself, never about the account. Group it under these labels, naming who said each item and citing the source:
- **Framing and narrative**: what story to tell, what to lead with.
- **Wording changes**: quote the before and after when the session gives both.
- **Structure and format**: slides to add, cut, merge, or reorder.
- **Verify before presenting**: numbers, dates, or charts a reviewer questioned.
- **What worked**: praise, in the reviewer's own words where possible.
- **Standing coaching**: guidance that applies to every account, not just this one.

### Leadership Questions Asked

A table of Question | Asked By | Answer Given | Status, where Status is Answered, Partial, or Follow-up owed. These are the questions to have an answer ready for next time, so record the ones that got a weak answer as carefully as the ones that did not get one at all.

### Usage And Data Claims

A table of Claim | Source | Period | Caveat Stated | Conflicts With, covering every usage, seat, machine, bookings, or churn figure discussed. Name the source as one of: Telemetry, License manager logs, CRM or BI bookings, Usage slide export, Email or campaign tooling, Verbal estimate. Record a figure that was dismissed as implausible together with the reason it was dismissed; that reasoning is what stops it coming back next quarter.

### Led Versus Relayed

Two lists, because a scorecard that claims the account team's work as the CSM's is as wrong as one that relays it with no attribution:
- **Led by the CSM**: work the CSM ran or executed, with the result.
- **Relayed from others**: work owned by the account manager, account team, product, support, or the customer, with the owner named.
Where the session does not make ownership clear, put the item under Relayed and add "(ownership unclear)".

### Commitments For Next Review

Scorecard-level commitments as checkboxes, each carrying every field:
- [ ] [Commitment] | **Owner:** [name or team] | **Due:** [date or trigger] | **Done when:** [what completion looks like] | **Pillar:** [pillar it moves] | **Dependency:** [blocker or "None"]
Leave the ordinary to-dos in Action Items; add "[scorecard-commitment]" to the matching Action Items line so the two stay connected.
If commitments from a previous review were checked off in this session, list each one with Done, In progress, Blocked, or Dropped.

### Support Asks Raised

A table of Ask | Team Being Asked | Status, where Status is New, Standing, or Resolved. Group by the team that can act on it, not by the pillar it came from.

### Cross-Account References

Any other customer raised as a precedent or comparison, listed under that customer's name. These are the facts most likely to end up misfiled as this account's, so they live here and nowhere else in the note.

### Verify Before Use

- A date or quantity stated two different ways, with both versions quoted.
- A name, product, or site the transcript may have misheard.
- A plan that could be mistaken for an agreement.
- Anything a speaker flagged as unconfirmed.

## Naming a usage figure's source

Every usage number carries the source it came from, because each source is blind
to something different and the reader cannot tell which number is which:

- **Telemetry** — connected machines only.
- **License manager logs** — only the logs the customer chooses to send.
- **CRM or BI bookings** — misses a late or misfiled renewal.
- **Usage slide export** — a point in time, not a live figure.
- **Email or campaign tooling** — blocked tracking under-reports engagement.
- **Verbal estimate** — unverified, name who said it.

## Checks on a saved note

| Check | Severity | What it catches | How to resolve it |
|-------|----------|-----------------|-------------------|
| `missing-section` | Must fix | A section this kind of session is supposed to carry is absent. | Add the section, or write "Not discussed" under it. |
| `alias-token` | Must fix | A pseudonymization alias such as PERSON_2 left in the saved note. | Restore the real name, or cut the line. An alias is meaningless to every later reader. |
| `owner-merged` | Must fix | The note owner merged with another speaker, as in "Owner (Manager)". | Re-attribute from the transcript; whoever ran the review is usually not the note owner. |
| `owner-pronoun` | Must fix | A pronoun for the note owner that contradicts the configured pronouns. | Use the configured pronouns, or leave the pronoun out. |
| `pillar-missing` | Should fix | A pillar with no row in the ratings table. | Add the row with "Not discussed" rather than leaving the pillar out. |
| `rating-no-colour` | Should fix | A ratings row with no colour and no "Not discussed". | Record the colour that was stated, or say it was not discussed. |
| `colour-word` | Should fix | "Amber" used as a rating outside a quotation. | Write Yellow, and keep the speaker's wording in the reason column. |
| `duplicate-callout` | Should fix | The same person listed twice in the callouts. | Merge the entries under one name. |
| `unsourced-claim` | Should fix | A usage or bookings claim with no source named. | Name the source and the period, or move the claim to Verify Before Use. |
| `commitment-fields` | Should fix | A commitment missing its owner, timing, or completion test. | Fill in every field; a commitment with no completion test cannot be reviewed next quarter. |
| `cross-account` | Should fix | Another customer named outside Cross-Account References. | Move it into that section, under that customer's name. |
| `stray-punctuation` | Should fix | A line ending in stray punctuation left by the generator. | Delete the trailing character. |

## Logging one of these sessions

The session itself is usually an internal activity: account planning, or a review
of one account's health with the account team. A manager one-to-one about the
scorecard is not reportable at all. Whatever the record says, the scorecard
content belongs in the note's sections above, not in the activity comment.
