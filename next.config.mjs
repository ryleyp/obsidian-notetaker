import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    // The app always runs on the same machine as the browser, so the server's
    // platform is the user's platform. Exposing it here keeps the value
    // identical on both sides of hydration.
    NEXT_PUBLIC_HOST_PLATFORM: process.platform,
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
