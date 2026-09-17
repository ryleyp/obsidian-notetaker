import { test, expect } from "@playwright/test";

const rows = [
  { eventDate: "2026-08-20", title: "Admin Sync", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Reviewed licensing.", agreement: "EA 123", origin: "note", sourceTitle: "Admin Sync" },
  { eventDate: "2026-08-19", title: "Customer Sync", type: "Strategic Relationship Management", subtype: "Other", comments: "Reviewed the rollout.", origin: "generated", sourceTitle: "Customer Sync" },
];
const changes = rows.map((row, index) => ({ index, title: `${row.title} Improved`, type: row.type, subtype: row.subtype, comments: `${row.comments} Confirmed next steps.` }));
const stream = (text) => `data: ${JSON.stringify({ type: "delta", text })}\n\ndata: ${JSON.stringify({ type: "done", usage: { input_tokens: 20, output_tokens: 30 }, model: "gpt-5.6-terra" })}\n\n`;

async function setup(page, { restoreReport = false, notes = [] } = {}) {
  const requests = [];
  await page.addInitScript(({ rows, restoreReport }) => {
    localStorage.setItem("obsidian-notes-settings", JSON.stringify({ vaultPath: "/tmp/openai-smoke-vault", openaiApiKey: "test-openai-key", apiKey: "test-claude-key", aiPrivacyScan: false, accounts: [], replacements: [], corrections: [] }));
    if (restoreReport) {
      localStorage.setItem("report:ea-activity", JSON.stringify({ output: rows.map((r) => JSON.stringify(r)).join("\n"), saved: true, savedPath: "EA Activity Report.md" }));
      localStorage.setItem("sfdc:filed-rows", JSON.stringify({ "2026-08-20|admin sync": { ts: Date.now(), row: rows[0] } }));
    }
  }, { rows, restoreReport });
  await page.route("**/api/**", async (route) => {
    const name = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    requests.push({ name, body });
    if (name === "/api/process" || name === "/api/regenerate" || name === "/api/synthesize") {
      const text = name === "/api/synthesize" ? JSON.stringify(rows[1]) : `## Executive Summary\n\n${name === "/api/regenerate" ? "Improved" : "Original"} note.\n\n## Meeting Notes\n\nPlan approved.\n\n## SFDC Activity Entry\n\nSummary: Plan approved.`;
      return route.fulfill({ contentType: "text/event-stream", body: stream(text) });
    }
    const responses = {
      "/api/session": { token: "test-token" }, "/api/paths": {}, "/api/config": {}, "/api/folders": { folders: [] },
      "/api/ea-report-filed": { report: null }, "/api/notes": { notes, counts: {} },
      "/api/improve-activities": { message: "Reviewed both existing and new activities.", changes },
      "/api/save": { savedPath: "EA Activity Report.md", filename: "EA Activity Report.md" },
    };
    await route.fulfill({ status: Object.hasOwn(responses, name) ? 200 : 400, json: responses[name] || { error: `Unexpected API: ${name}` } });
  });
  await page.goto("/");
  return requests;
}

test("improves reopened EA rows through ChatGPT and preserves Filed state when saving", async ({ page }) => {
  const requests = await setup(page, { restoreReport: true });
  await page.getByRole("button", { name: "EA Activity", exact: true }).click();
  await page.getByRole("button", { name: /Improve all activities with OpenAI \(ChatGPT\)/ }).click();
  await expect(page.getByText("Proposed edits to 2 activities")).toBeVisible();
  expect(requests.find((r) => r.name === "/api/improve-activities").body).toMatchObject({ model: "gpt-5.6-terra", openaiApiKey: "test-openai-key", rows: [{ origin: "note" }, { origin: "generated" }] });
  await page.getByRole("button", { name: "Apply proposed edits" }).click();
  const first = page.locator("tbody tr").first();
  await expect(first).toContainText("Admin Sync Improved");
  await expect(first.getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: "Save to Obsidian", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved!", exact: true })).toBeVisible();
  const saved = requests.find((r) => r.name === "/api/save").body.notes;
  expect(saved).toContain("| Filed | Event Date | Title | Type | Subtype | EA/EP | Source Note | Comments |");
  expect(saved).toContain("| [x] | 2026-08-20 | Admin Sync Improved |");
  expect(saved).toContain("EA 123");
});

test("runs the optional ChatGPT pass after harvesting and generating activities", async ({ page }) => {
  const notes = [
    { filename: "Admin.md", title: "Admin Sync", date: "2026-08-20", content: "## SFDC Activity Entry\n\n**Type:** Strategic Relationship Management\n**Subtype:** EA Admin Sync\n**Summary/Notes:**\nReviewed licensing." },
    { filename: "Customer.md", title: "Customer Sync", date: "2026-08-19", content: "Customer approved the rollout." },
  ];
  const requests = await setup(page, { notes });
  await page.getByRole("button", { name: "EA Activity", exact: true }).click();
  await page.getByRole("button", { name: "Scan Folder", exact: true }).click();
  await page.getByRole("radio", { name: /Second opinion/ }).check();
  await page.getByRole("button", { name: "Generate EA Activity Report", exact: true }).click();
  await page.getByRole("button", { name: "Build table & get second opinion", exact: true }).click();
  await expect(page.getByText("Proposed edits to 2 activities")).toBeVisible();
  const sent = requests.find((r) => r.name === "/api/improve-activities").body;
  expect(sent.model).toBe("gpt-5.6-terra");
  expect(sent.rows.map((r) => r.origin)).toEqual(["note", "generated"]);
  expect(sent.notes).toHaveLength(2);
});

test("generates a ChatGPT note and compares a source-backed Claude second opinion in the same layout", async ({ page }) => {
  const requests = await setup(page);
  await page.getByPlaceholder("e.g. 2026-06-05 - Acme Kickoff").fill("Planning");
  await page.getByPlaceholder("Paste your meeting transcript here...").fill("Acme approved the licensing plan.");
  await page.getByRole("button", { name: /Balanced GPT-5\.6 Terra/ }).click();
  await page.getByRole("radio", { name: /Second opinion/ }).check();
  await page.getByRole("button", { name: "Generate Meeting Notes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Executive Summary", exact: true })).toBeVisible();
  expect(requests.find((r) => r.name === "/api/process").body.model).toBe("gpt-5.6-terra");
  const comparison = page.getByRole("region", { name: "AI review workspace" });
  await expect(comparison.getByRole("button", { name: "Use this section", exact: true })).toBeVisible();
  await comparison.getByRole("button", { name: "Use this section", exact: true }).click();
  await expect(page.getByText("Improved note.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "SFDC Activity Entry", exact: true })).toBeVisible();
  const request = requests.find((r) => r.name === "/api/regenerate").body;
  expect(request.model).toBe("claude-sonnet-5");
  expect(request.instruction).toContain("same Markdown headings");
  await page.reload();
  await expect(page.getByText(/Recent meeting-note drafts/)).toBeVisible();
});
