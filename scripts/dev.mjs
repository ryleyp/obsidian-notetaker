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
