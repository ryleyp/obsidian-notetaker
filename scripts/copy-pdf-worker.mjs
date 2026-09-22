// pdf.js parses PDFs in a Web Worker shipped as a separate module. Serving
// it from public/ at a fixed URL is pdf.js's own documented setup and keeps
// the worker out of the bundler's hands entirely: same path under `next
// dev`, the production build, and the Windows launcher, no hashed asset to
// resolve at runtime. The copy is gitignored and refreshed on every install.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const target = resolve(root, "public/pdf.worker.min.mjs");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`pdf.js worker → public/pdf.worker.min.mjs`);
