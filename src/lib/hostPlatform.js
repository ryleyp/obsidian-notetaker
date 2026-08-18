// The app runs on the same machine as the browser, so the server's platform is
// the user's platform. next.config.mjs exposes it as a public env var, which is
// inlined at build time and therefore identical on both sides of hydration.
export const isWindowsHost = process.env.NEXT_PUBLIC_HOST_PLATFORM === "win32";

export const EXAMPLE_VAULT_PATH = isWindowsHost
  ? "C:\\Users\\yourname\\Documents\\MyVault"
  : "/Users/yourname/Documents/MyVault";

export const EXAMPLE_TRANSCRIPTS_PATH = isWindowsHost
  ? "C:\\Users\\yourname\\Documents\\Claude"
  : "/Users/yourname/Documents/Claude";
