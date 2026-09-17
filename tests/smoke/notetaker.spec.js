import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";

test("approves a local vault and reaches the ready-to-generate workflow", async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-smoke-"));
  const vault = path.join(root, "Vault");
  fs.mkdirSync(path.join(vault, "Customers", "Cardinal"), { recursive: true });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Obsidian vault path").fill(vault);
  await page.getByRole("button", { name: "Test Path" }).click();
  await expect(page.getByText(/Found \d+ folders in vault/)).toBeVisible();
  await page.getByRole("button", { name: "Save Settings" }).click();

  await expect(page.getByText("Destination Folder")).toBeVisible();
  await expect(page.getByRole("button", { name: "Customers", exact: true })).toBeVisible();

  await page.getByPlaceholder("e.g. 2026-06-05 - Acme Kickoff").fill("2026-05-12 - Cardinal SystemLink Sync");
  await page.getByPlaceholder("Paste your meeting transcript here...").fill(
    "Cardinal confirmed SystemLink deployment is now approved. Older IT blockers are resolved."
  );
  await page.getByRole("button", { name: "+ Add second transcript from the same meeting" }).click();
  await page.getByPlaceholder("Paste a second transcript from the same meeting...").fill(
    "The longer recording also captured Priya agreeing to send the license list by Friday."
  );
  await page.getByRole("checkbox", { name: /Also generate a follow-up email/ }).check();
  await page.getByLabel("Follow-up audience").selectOption("internal");
  await page.getByLabel("Follow-up tone").selectOption("technical");
  await expect(page.getByLabel("Follow-up audience")).toHaveValue("internal");
  await expect(page.getByLabel("Follow-up tone")).toHaveValue("technical");

  await expect(page.getByRole("button", { name: /Generate Meeting Notes/ })).toBeEnabled();
});

test("builds an account-isolated health score with optional prior-review inputs", async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-health-smoke-"));
  const vault = path.join(root, "Vault");
  const accountFolder = path.join(vault, "Customers", "Cardinal Defense");
  fs.mkdirSync(accountFolder, { recursive: true });
  fs.writeFileSync(
    path.join(accountFolder, "2026-09-01 - Quarterly Health Review.md"),
    "# 2026-09-01 Quarterly Health Review\n\nCardinal Defense confirmed a growing software deployment. The sponsor review remains open."
  );

  let notesUrl = "";
  let synthesisBody = null;
  page.on("request", (request) => {
    if (request.url().includes("/api/notes?")) notesUrl = request.url();
  });
  await page.route("**/api/pdf-text", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ filename: "Q2 Scorecard.pdf", pages: 4, text: "Prior Cardinal Defense overall health was Yellow.", truncated: false }),
    });
  });
  await page.route("**/api/synthesize", async (route) => {
    synthesisBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"delta","text":"# Cardinal Defense Customer Success Health\\n\\n**Overall Health:** Yellow"}\n\ndata: {"type":"done","usage":{"input_tokens":100,"output_tokens":50},"model":"claude-haiku-4-5"}\n\n',
    });
  });

  await page.goto("/");
  await page.getByLabel("Obsidian vault path").fill(vault);
  await page.getByRole("button", { name: "Test Path" }).click();
  await expect(page.getByText(/Found \d+ folders in vault/)).toBeVisible();
  await page.getByRole("button", { name: "Save Settings" }).click();

  await page.getByRole("button", { name: "Health Score" }).click();
  await expect(page.getByRole("heading", { name: "Generate Health Score" })).toBeVisible();
  await page.getByRole("button", { name: "Customers/Cardinal Defense" }).click();
  await page.getByRole("button", { name: "Scan Folder" }).click();
  await expect(page.getByText("1 source note found")).toBeVisible();
  expect(notesUrl).toContain("folderPath=Customers%2FCardinal+Defense");
  expect(notesUrl).not.toContain("accountAliases");
  expect(notesUrl).not.toContain("transcriptsPath");

  await page.getByRole("checkbox", { name: /previous slide deck/i }).check();
  await page.getByLabel("Previous scorecard PDF").setInputFiles({ name: "Q2 Scorecard.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 smoke") });
  await expect(page.getByText(/Q2 Scorecard\.pdf · 4 pages/)).toBeVisible();
  await page.getByLabel("Prior review transcript").selectOption("2026-09-01 - Quarterly Health Review.md");

  await page.getByRole("button", { name: "Generate Health Score" }).click();
  await expect(page.getByText("Pre-flight check")).toBeVisible();
  await page.getByRole("button", { name: "Generate Health Score" }).click();
  await expect(page.getByRole("heading", { name: "Cardinal Defense Customer Success Health" })).toBeVisible();
  expect(synthesisBody.promptType).toBe("health-score");
  expect(synthesisBody.previousDeckName).toBe("Q2 Scorecard.pdf");
  expect(synthesisBody.reviewTranscriptFilename).toBe("2026-09-01 - Quarterly Health Review.md");
  expect(synthesisBody.notes).toHaveLength(1);
});
