"use client";

let sessionTokenPromise = null;

// The server issues a fresh token whenever the process (re)starts, held only
// in memory (src/lib/sessionToken.js). A tab left open across a restart —
// including the dev server picking up a code change — is still holding the
// old one, so force a refetch instead of reusing the cached promise.
export async function getApiSessionToken({ forceRefresh = false } = {}) {
  if (forceRefresh) sessionTokenPromise = null;
  if (!sessionTokenPromise) {
    sessionTokenPromise = fetch("/api/session")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.token) throw new Error(data.error || "Could not start local session");
        return data.token;
      })
      .catch((error) => {
        sessionTokenPromise = null;
        throw error;
      });
  }

  return sessionTokenPromise;
}

export async function apiFetch(input, init = {}) {
  const token = await getApiSessionToken();
  const headers = new Headers(init.headers || {});
  headers.set("x-notetaker-session", token);

  const res = await fetch(input, { ...init, headers });
  if (res.status !== 401) return res;

  // The token this tab is holding was rejected — most likely a stale one
  // from before a server restart. Fetch a new one and retry exactly once;
  // if the retry also 401s, that's a real auth failure, so it's returned
  // as-is rather than looping.
  const freshToken = await getApiSessionToken({ forceRefresh: true });
  const retryHeaders = new Headers(init.headers || {});
  retryHeaders.set("x-notetaker-session", freshToken);
  return fetch(input, { ...init, headers: retryHeaders });
}

export async function approveLocalPaths(settings) {
  const res = await apiFetch("/api/paths", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vaultPath: settings.vaultPath || "",
      transcriptsPath: settings.transcriptsPath || "",
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not approve local paths");
  return data;
}
