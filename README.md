# Obsidian Meeting Notes

A local web app that turns meeting transcripts into structured Obsidian notes using Claude. Pick Haiku, Sonnet, or Opus per run; Opus is the default.

## What it does

Upload or paste a meeting transcript, select a folder in your Obsidian vault, and Claude generates:

1. **Executive Summary** — 3-5 sentence overview of the meeting
2. **Meeting Notes** — Complete, consolidated bulleted notes covering every important point once, without filler or sentiment commentary
3. **NI SW Customer Success Takeaways** — Items your CS team needs to know
4. **Action Items** — Checkbox-style tasks with owner and due date
5. **Next Steps** — Agreed follow-ups and upcoming milestones

Notes are saved directly as `.md` files into your vault, instantly visible in Obsidian.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add your Anthropic API key

Create a `.env.local` file in the project root:

```bash
cp .env.example .env.local
```

On Windows (PowerShell):

```powershell
Copy-Item .env.example .env.local
```

Then edit `.env.local` and add your key:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Alternatively, you can enter the API key directly in the app's Settings panel — it's stored only in your browser session.

Get an API key at [console.anthropic.com](https://console.anthropic.com).

### 3. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Configure in the app

- Open **Settings** and enter your Obsidian vault path — `/Users/yourname/Documents/MyVault`
  on macOS, `C:\Users\yourname\Documents\MyVault` on Windows
- Click **Test Path** to verify it works

## Windows

Everything above works the same on Windows; `npm run dev` sets the environment it
needs from Node, so PowerShell and `cmd.exe` both work.

Instead of typing commands each time, double-click **`Start Notetaker.bat`** in the
project folder. It installs dependencies on first run, starts the server in a
minimised window, and opens the browser. Close that minimised window to stop the app.

Notes on paths:

- Use the full path including the drive letter, e.g. `C:\Users\yourname\Documents\MyVault`.
  Both `\` and `/` are accepted.
- A vault synced through OneDrive works, but use the local path OneDrive keeps on
  disk (usually under `C:\Users\yourname\OneDrive\...`), not a web link.
- If PowerShell blocks the launcher with an execution-policy error, run it as
  `powershell -ExecutionPolicy Bypass -File scripts\start-notetaker-local.ps1`
  (this is what the `.bat` file already does).

## Usage

1. Enter the meeting title and date
2. Paste or upload one or two transcripts. Use **Add second transcript** or the optional extended upload for another recording of the same meeting (for example, Teams plus Voice Memos). Uploads accept `.txt` and `.md` files.
3. Select the target folder in your vault (right panel)
4. Optionally select **Also generate a follow-up email** and choose its audience and tone. This adds the email to the same Claude request, separates it from the meeting note, and saves it automatically under `Follow Up Emails`.
5. Click **Generate Meeting Notes**
6. Review the preview, then click **Save to Obsidian**

You can also draft or redraft a follow-up after generating notes and save it manually. The `Follow Up Emails` folder is created automatically, and the follow-up uses the same title as the meeting summary. Repeated saves use unique filenames instead of overwriting earlier drafts.

The file is saved as `YYYY-MM-DD - Meeting Title.md` in your chosen folder.

### Slides shown in the meeting

Screenshot the deck and drop the images into the **Slides shown in the meeting** panel under
the transcript. Each slide is read once, into text, by your selected model — title, every
bullet, tables as tables, and the numbers printed on charts, verbatim, never summarised — and
from then on it is an ordinary source: pseudonymized like a transcript, cited in the note as
`[S#]` (numbered by position in the deck), shown in the source panel, and saved under
**Slides shown** in the transcript archive. The images themselves are sent exactly once and
never again, so regenerating, second opinions, and comparisons stay cheap and consistent.

The notes treat what was *shown* as a source beside what was *said*: figures, product names,
and roadmap items that appear only on a slide go into the Meeting Notes even if nobody read
them aloud, the slide is authoritative for exact numbers and spellings, and the transcript for
what was decided. A slide that was shown but never discussed and carries nothing
account-relevant gets no mention.

Screenshots are resized to 1600px on the longest edge before upload, up to 24 per meeting.
One thing privacy replacements cannot do is edit pixels: the picture goes to the model as it
is, so crop anything that must not leave your machine before dropping it in.

### Fiscal-year folders

With **File notes by fiscal year** on (Settings), a note saved into an account folder
lands in an `FY<year>` subfolder chosen by the date in its title. The fiscal year runs
October 1 through September 30 and is named for the year it ends in, so October 2025
through September 2026 is `FY2026`:

```
1. Acme Aerospace/
  FY2026/
    2026-09-08 - Acme Sync.md
  FY2027/
    2026-10-02 - Acme Kickoff.md
```

A note whose title carries no date stays in the account folder rather than being filed
by guesswork. Filing only changes where notes are *written*: reports, the customer facts
rollup, site and contact mapping, keyword suggestions, cleanup and the goal review all
read an account folder together with every fiscal year inside it, so referencing an
account still covers its whole history. An email thread that started in one fiscal year
keeps updating in place when a reply arrives in the next one.

To file notes you already have, use **Preview filing** in Settings. It plans the moves,
shows them per account and year, and writes nothing until you apply. Every run is
recorded and can be reversed with **Undo last filing**.

Raw transcript saves are deduplicated. Uploading identical transcript content reuses
the existing file, and saving changed content under the same transcript title updates
that archive file instead of creating a numbered copy.

### EA Activity entries

Every generated note ends with an SFDC Activity Entry — the part that gets pasted into
Salesforce verbatim. It carries a Salesforce-ready **Recommended Title** (what the EA
Activity report shows as Improved Title), the Type/Subtype
pair, EA/EP numbers, a **Reportable** verdict, and a Summary/Notes block in four labelled
parts:

```
Summary:      who took part with roles, what drove the engagement, what was covered
Contribution: what the CSM personally did, opening with a real verb
Outcomes:     what was confirmed (expected impact labelled as expected)
Next steps:   the CSM's own actions, with owner and date when stated
```

Before you save, the note preview runs a **postability check** on that entry: Salesforce's
800-character / 120-word limit, first person, the CSM's own name, leftover `[T1]` markers,
placeholders, "CSM attended", corporate filler, a missing contribution, an unsupported
revenue claim, and the user-group comment format. Fixes that cannot change meaning — name
to "CSM", markers out, empty `Outcomes: None stated` fragments out — apply with one click;
anything needing judgement is listed for you.

Marking an entry **Reportable: No** (manager 1:1s, internal syncs with no decision, training
you took) keeps it in the note but out of the EA Activity report, unless you tick *Include
notes marked not reportable* when building the report.

### The EA Activity report

The report harvests the entry each note already carries — no model call, no reclassification —
and only sends notes without one to the model. Both paths now share the same classification
guidance and the same four-part comment format, so harvested and generated rows read
identically.

Every row is linted as it lands in the table. Red tags are what Salesforce or the reporting
convention rejects as written; amber tags will read badly to whoever opens the record.
**Fix N safe issues** applies the meaning-preserving fixes across every unfiled row at once,
and whatever is left is handed to the improvement pass so it targets real defects instead of
rewording rows that were already fine.

Under the table, a portfolio review reads the quarter as a whole — the customer-facing to
internal mix, over-concentration in one category, repeated `Other`, same-day duplicate titles,
inconsistent EA/EP identifiers, invalid classifications, and long stretches with nothing
logged. It costs nothing to run and updates as you edit rows.

### The EA Activity skill

`skills/ea-activity-report/` is the same reporting standard packaged as a Claude Code skill,
for the work that happens outside the app — a record written from a pasted transcript, a
rewrite of a comment that reads badly, a review of what is already in Salesforce.

Install it by linking it into your skills directory, so regenerating it here updates it there:

```bash
ln -s "$PWD/skills/ea-activity-report" ~/.claude/skills/ea-activity-report
```

Its three reference documents — the taxonomy, the quality checks, and the health scorecard
session layer — are generated from `src/lib/sfdcTaxonomy.js`, `src/lib/activityLint.js`, and
`src/lib/healthSession.js` by `npm run skill`. Never hand-edit them: `npm test` fails when
they drift from the app's own definitions, which is what keeps the skill and the app from
quietly enforcing two different standards.

### Health scorecard sessions

A meeting about account health itself — a leadership review, a pre-sync with the account
manager, scorecard coaching, a portfolio roll-up — is detected from the title, your context
notes, and the transcript, and the note gains sections the ordinary format has no room for:
every pillar's colour with who set it and whether it moved, feedback on the deck kept apart
from facts about the account, the questions leadership asked, each usage figure with the
source it came from, what you led as against what you are relaying, the commitments due at
the next review, the support asks, and any other customer raised as a precedent.

The quarterly scorecard is built from those sections months later, so the note preview runs
a second check over them: a pillar with no row, a colour with no reason, a merged speaker, a
pronoun that contradicts the pronouns in Settings, an unrestored `PERSON_2`, a usage claim
with no source, a commitment with no completion test, another account's name outside the
cross-account section.

### Upgrade an old meeting note

1. Paste the old meeting transcript and select its customer folder.
2. Under **Save behavior**, choose **Update existing** and select the matching Obsidian note.
3. Generate and review the current-format note, then click **Update in Obsidian**.

The old note is included as a secondary source so manually recorded attendee roles,
site facts, and callouts can survive the migration. The transcript remains authoritative.
When you save, Notetaker backs up the original under `.notetaker/backups/` and replaces
the exact selected file instead of creating a numbered duplicate.

### Customer facts and callouts

Every saved customer meeting rebuilds `Customer Facts & Callouts.md` in that customer
folder. It combines, with links back to each meeting:

- people and attendee callouts;
- site, lab, and location callouts; and
- NI Software Customer Success callouts and facts.

Because the file is rebuilt from the folder's meeting notes, rerunning the same meeting
refreshes its contribution without appending a duplicate. Historical migrations do not
append another copy of the meeting to weekly ToDo or SFDC activity files.

### Email thread notes

Email thread generation uses the streaming Claude request path, including with Haiku.
Email addresses are detected locally and shown in Privacy Review as `EMAIL_#` aliases
before any content is sent to Claude, even when AI privacy scanning is disabled. After
the email note is saved, its generated SFDC Activity Entry is also added to the weekly
SFDC Activity Report.

The thread title is the stable email-note identity. Uploading the same title again
updates the existing note (after creating a backup), replaces the previous SFDC
activity even when the note date moves to another week, and rebuilds the customer
facts and callouts note from the latest content.

## Requirements

- Node.js 18+
- An Anthropic API key
- Your Obsidian vault accessible on the local file system
- macOS, Windows, or Linux

### ChatGPT for notes and EA activity

Add an **OpenAI API Key (ChatGPT)** in Settings (or set `OPENAI_API_KEY`
in `.env.local`). Select **GPT-6 Astra**, **GPT-5.6 Sol**, **GPT-5.6 Terra**, or **GPT-5.6 Luna** in the model picker to use
OpenAI for new meeting notes, email notes, or reports. Claude remains available.
The same prompts, Markdown note layout, SFDC taxonomy, and activity table
format are used with either provider. OpenAI API access is billed separately.

Every model option displays its input and output price per million tokens.
Pre-flight panels show estimated input, output, and total cost, while completed
runs show actual token usage and cost. Run modes can generate once, request a
source-backed second opinion, compare independent Claude and ChatGPT drafts, or
review flagged activities. Notes support section-level acceptance; EA reports
support field- and activity-level acceptance. Dates, agreement numbers, source
links, and Filed status remain intact. The improvement pass supports up to 80 rows.

The simplified picker offers **Auto**, **Fast**, **Recommended**, and **Highest
quality** presets; the complete Claude and ChatGPT model lists remain under
Advanced. Auto routes generation to a balanced model and classification,
privacy, verification, speaker detection, and cleanup work to a lower-cost
model using whichever provider key is configured. The AI review workspace keeps
alternatives, source evidence, undo, and persistent draft history together.

Provider requests retain the existing corrections and privacy filters. OpenAI
uses the [Responses API](https://developers.openai.com/api/docs/guides/streaming-responses)
with `store: false`; model limits and cost estimates follow the
[OpenAI model documentation](https://developers.openai.com/api/docs/models).
