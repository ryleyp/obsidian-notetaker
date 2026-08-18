#!/usr/bin/env node
// Cross-platform `next dev` launcher.
//
// The dev server needs WATCHPACK_POLLING so file changes are picked up on
// network/virtualised volumes. `VAR=value command` is shell syntax that does
// not work in cmd.exe or PowerShell, so the env var is set here instead of in
// the npm script. Next is spawned through Node directly rather than through
// its `.cmd` shim, which keeps argument quoting identical on every platform.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const MIN_NODE = "20.9.0";

function isTooOld(current, minimum) {
  const a = current.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < b.length; i++) {
    if ((a[i] || 0) !== b[i]) return (a[i] || 0) < b[i];
  }
  return false;
}

// Next.js checks this too, but only after npm has printed its own banner, which
// buries the reason. Say it first, and say what to do about it.
if (isTooOld(process.versions.node, MIN_NODE)) {
  console.error(
    `Node.js ${MIN_NODE} or newer is required — this is Node.js ${process.versions.node}.\n` +
    "Install the current LTS build from https://nodejs.org, then open a new terminal and run `npm install` again."
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const env = { ...process.env };
if (env.WATCHPACK_POLLING === undefined) env.WATCHPACK_POLLING = "true";

const args = [nextBin, "dev", "--webpack", "--hostname", "127.0.0.1", ...process.argv.slice(2)];

const child = spawn(process.execPath, args, { stdio: "inherit", env });

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
child.on("error", (error) => {
  console.error(`Could not start Next.js: ${error.message}`);
  process.exit(1);
});
