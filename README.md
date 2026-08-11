# Obsidian Meeting Notes

A local web app that turns meeting transcripts into structured Obsidian notes using Claude. Pick Haiku, Sonnet, or Opus per run; Opus is the default.

## What it does

Upload or paste a meeting transcript, select a folder in your Obsidian vault, and Claude generates:

1. **Executive Summary** — 3-5 sentence overview of the meeting
2. **Meeting Notes** — Exhaustive bulleted notes covering every important point
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

- Open **Settings** and enter your Obsidian vault path (e.g. `/Users/yourname/Documents/MyVault`)
- Click **Test Path** to verify it works

## Usage

1. Enter the meeting title and date
2. Paste or upload one or two transcripts. Use **Add second transcript** or the optional extended upload for another recording of the same meeting (for example, Teams plus Voice Memos). Uploads accept `.txt` and `.md` files.
3. Select the target folder in your vault (right panel)
4. Optionally select **Also generate a follow-up email** and choose its audience and tone. This adds the email to the same Claude request, separates it from the meeting note, and saves it automatically under `Follow Up Emails`.
5. Click **Generate Meeting Notes**
6. Review the preview, then click **Save to Obsidian**

You can also draft or redraft a follow-up after generating notes and save it manually. The `Follow Up Emails` folder is created automatically, and the follow-up uses the same title as the meeting summary. Repeated saves use unique filenames instead of overwriting earlier drafts.

The file is saved as `YYYY-MM-DD - Meeting Title.md` in your chosen folder.

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
