# Sharing This App — Setup Guide for a Friend

This is a **local web app**. It runs on your own computer and reads your
Obsidian vault directly off your hard drive. There is no website to visit
and no shared cloud version — you run your own copy. This guide takes you
from zero to a working app.

---

## What you need first

1. **Node.js 20.9 or newer** — check by running `node -v` in a terminal.
   If you don't have it, or the version is older, install from
   [nodejs.org](https://nodejs.org) (pick the "LTS" version). The installer
   upgrades an existing copy in place; open a new terminal afterwards so the
   new version is picked up.
2. **An Anthropic API key** — your own, not the person who shared this with
   you. Get one at [console.anthropic.com](https://console.anthropic.com).
   The key is tied to billing, so everyone uses their own.
3. **An Obsidian vault** on your computer (a folder of `.md` notes).

---

## Getting the code

### If you were given a GitHub link
```bash
git clone <the-repo-url>
cd notetaker-webapp
```

(On Windows, open **PowerShell** or **Command Prompt** in the folder you want
the project in and run the same commands.)

### If you were sent a zip file
Unzip it, then open a terminal in that folder. (The zip should NOT contain
`node_modules` or a `.env.local` file — you'll create those below.)

---

## Setup (one time)

From inside the project folder:

### 1. Install dependencies
```bash
npm install
```

### 2. Add your API key
Copy the example env file:
```bash
cp .env.example .env.local
```
On Windows (PowerShell):
```powershell
Copy-Item .env.example .env.local
```
Then open `.env.local` in any text editor and paste your key:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```
(You can also skip this and paste the key into the app's Settings panel
instead — it's stored only in your browser.)

### 3. Start the app
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Point it at your vault
- Open **Settings** in the app
- Enter the full path to your Obsidian vault —
  `/Users/yourname/Documents/MyVault` on Mac,
  `C:\Users\yourname\Documents\MyVault` on Windows
- Click **Test Path** to confirm it works

---

## Running it day to day

Each time you want to use it:
```bash
cd notetaker-webapp
npm run dev
```
Then open http://localhost:3000. Close the terminal when you're done.

There's also a double-click launcher so you don't have to type commands:

- **Mac:** `Start Notetaker.command`
- **Windows:** `Start Notetaker.bat`

Both start the server and open the browser. On Windows the server keeps
running in a minimised window — close it to stop the app.

---

## What the app does

It has several tabs:
- **New Note** — paste a meeting transcript, get structured Obsidian notes
- **Account Status** — quarterly account summary from your notes
- **SL Status** — SystemLink-focused account summary
- **EA Activity** — generates an activity table for Salesforce reporting

---

## Things you'll probably want to change

This app was built for a specific NI Software CS workflow. Some parts are
tailored and you may want to adjust them:

- **Accounts** (Settings) — set up your own account names, aliases, and
  keywords. Aliases drive cross-folder search; keywords keep one account's
  terms out of another account's summary.
- **EA Activity taxonomy** — the Type/Subtype categories in the EA Activity
  tab are specific to NI's Salesforce setup. If your categories differ,
  they're defined in `src/app/api/synthesize/route.js` (look for
  `buildCSMActivityPrompt`).
- **Report structure** — the Account Status pillars and sections are also
  in `src/app/api/synthesize/route.js`.

---

## Important notes

- **Never share your API key.** It's tied to your billing. If you got this
  app from someone, do not reuse their key — get your own.
- **It only works on your machine with your vault.** Nothing is uploaded or
  shared; your notes stay local. Notes are sent to Anthropic's API only when
  you click Generate.
- **Privacy:** the app pseudonymizes names from your glossary before sending
  text to Claude, and reverses them in the output.

---

## Troubleshooting

- **"Node.js version >=20.9.0 is required"** — you have an older Node. Install
  the current LTS from [nodejs.org](https://nodejs.org), open a new terminal,
  then run `npm install` again before `npm run dev`.
- **Windows: `npm` crashes with `Class extends value undefined`** — `node` and
  `npm` are coming from different Node installations, usually because
  nvm-windows left an old version ahead of the new one on your PATH. Check with
  `where.exe node` and `where.exe npm`: the first hit for each must be the same
  folder. Fix it with `nvm use <version>` from an **Administrator** PowerShell
  (nvm needs admin to update its symlink; without it you get
  `exit status 5: Access is denied`). With no admin rights, put the right Node
  first for that window instead:
  ```powershell
  $env:Path = (Split-Path (Get-Command node).Source) + ";" + $env:Path
  ```
- **"command not found: npm"** (or `'npm' is not recognized` on Windows) —
  Node.js isn't installed, or the terminal was open before you installed it.
  See step 1 above, then open a new terminal.
- **Windows: "running scripts is disabled on this system"** — PowerShell's
  execution policy is blocking the launcher. Use `Start Notetaker.bat`, which
  bypasses it for that one script, or run
  `powershell -ExecutionPolicy Bypass -File scripts\start-notetaker-local.ps1`.
- **Blank page / port in use** — something else is on port 3000. Stop it, or
  the app will pick another port (check the terminal output for the URL).
- **"API key required"** — add your key to `.env.local` or paste it into
  Settings.
- **Vault path won't validate** — make sure it's the full absolute path to
  the vault folder, and that the folder exists.
