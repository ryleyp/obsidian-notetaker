# Notetaker Desktop Wrapper

Run this once from the project folder:

```bash
./scripts/create-mac-app.sh
```

It creates `Notetaker.app` in the project root. Opening the app starts the local Next.js server on `127.0.0.1:3000` and opens the browser.

The wrapper keeps the project as a local web app, but removes the daily terminal step.

## Windows

There is no app bundle to build. Double-click `Start Notetaker.bat` in the project
root instead — it runs `scripts/start-notetaker-local.ps1`, which starts the same
local server on `127.0.0.1:3000` and opens the browser. To get it on the desktop,
right-click the `.bat` file and choose **Send to → Desktop (create shortcut)**.
