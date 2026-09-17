# Quality checks for an activity record

<!-- Generated from src/lib by `npm run skill`. Edit the source, not this file. -->

Run every check before handing a record over. "Must fix" means Salesforce or the
reporting convention rejects it as written; "should fix" means it will read badly to
whoever opens the record.

Hard limits: comment **800 characters and 120 words**, title **200 characters**.

| Check | Severity | What it catches | How to resolve it |
|-------|----------|-----------------|-------------------|
| `date` | Must fix | An event date that is not YYYY-MM-DD. | Use the date of the meeting or thread, from the note title. |
| `taxonomy` | Must fix | A Type/Subtype pair that is not an exact match in the taxonomy. | Copy both values character-for-character from the taxonomy. |
| `empty-comment` | Must fix | No comment at all. | Write the four labelled parts. |
| `redacted` | Must fix | A redaction mark, meaning another account's name was scrubbed out of this text. | Rewrite the sentence without the other account, or drop the row. |
| `over-limit` | Must fix | A comment over 800 characters or 120 words — Salesforce will not accept it. | Cut detail from Summary first; never cut Contribution or Outcomes. |
| `placeholder` | Must fix | A template placeholder that was never filled in, such as [Name] or <region>. | Fill it in from the sources, or remove the clause. "TBD" is honest for an unknown attendee count. |
| `csm-name` | Must fix | The CSM's own name in text other people read. | Say "CSM". Applied automatically. |
| `first-person` | Must fix | "I", "we", "our", "my" — activity records are written in the third person. | Rewrite in past tense with "CSM" as the subject. |
| `title-length` | Must fix | A title over 200 characters. | Shorten to the engagement and its purpose. |
| `citations` | Should fix | Source markers like [T1] or [N2], which mean nothing outside the note app. | Strip them. Applied automatically. |
| `passive-attendance` | Should fix | "CSM attended / observed / listened / was present". | Describe the meeting and say who led it; leave the CSM's presence unmentioned unless they contributed. |
| `jargon` | Should fix | Corporate filler: synergy, leverage, circle back, bandwidth, actionable, value-add, touch base. | Say the plain thing instead. |
| `no-outcome` | Should fix | "Outcomes: None stated" — honest in the note, noise in Salesforce. | Drop the fragment, or state what was actually confirmed. Removal applied automatically. |
| `empty-next-steps` | Should fix | "Next steps: None". | Drop the fragment, or name the next action. Removal applied automatically. |
| `group-format` | Should fix | A Demo Days or User Group row without "Region: X, Attendees: #" and an outcome. | Add region and attendance (TBD is fine) and state the impact. |
| `title-noise` | Should fix | A title carrying a leading date, a mail prefix (RE:/FW:/[EXTERNAL]), or a "(1)" duplicate suffix. | Strip them. Applied automatically. |
| `missing-agreement` | Should fix | No EA/EP number on a row while the account has agreements on file. | Add the number the engagement relates to, or leave blank deliberately. |
| `structure` | Should fix | Free prose with none of the three labels. | Rewrite as Summary / Outcomes / Next steps. |
| `no-contribution` | Should fix | Nothing saying what the CSM did — no defined, coordinated, escalated, resolved, and so on. | Say it in the Summary, carried by a real verb. Leave it out when the CSM genuinely only attended. |
| `revenue-claim` | Should fix | Revenue causation — drove renewal, generated expansion, closed the deal. | State what actually happened; claim revenue impact only when a source says it outright. |
| `no-participants` | Should fix | Nobody named and no role given. | Name the customer contact with their title when the sources give it. |
| `weak-title` | Should fix | A title naming the engagement but not its purpose, or under four words. | Add the initiative, team, site, or product. |
| `other-category` | Should fix | Type or Subtype filed as "Other". | Check whether a specific category fits. Repeated "Other" is a taxonomy gap worth raising. |
| `stale-planned` | Must fix | A record still marked Planned after its date has passed. | Update it with what actually happened and mark it Completed, or cancel it with a reason. |
| `planned-with-outcome` | Must fix | An outcome on a record for something that has not happened yet. | Remove the outcome until the engagement occurs, or correct the status. |
| `canceled-no-reason` | Should fix | A canceled record with no reason recorded. | Say briefly why it did not happen — postponed, declined, rescheduled. |
| `attendance-tbd` | Should fix | A past user group or demo still showing "Attendees: TBD". | Fill in the final count now that the event has happened. |
| `split-note` | Must fix | Two rows citing the same source note — one meeting or email thread split into several activities. | Merge them into one record: classify by the primary purpose and carry the other themes in the summary. |

These can be applied mechanically without changing meaning: `csm-name`, `citations`, `no-outcome`, `empty-next-steps`, `title-noise`.
Everything else needs a judgement call — make it, or hand the record back with the
problem named.
