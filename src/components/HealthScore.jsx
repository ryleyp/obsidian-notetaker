"use client";

import { useMemo, useState } from "react";
import FolderSelector from "@/components/FolderSelector";
import NotesPreview from "@/components/NotesPreview";
import { detectAccount } from "@/lib/accounts";
import { apiFetch } from "@/lib/apiClient";
import { useReportWorkflow, TODAY } from "@/hooks/useReportWorkflow";
import {
  BleedWarning,
  CountsBadges,
  GeneratePanel,
  HistoryMenu,
  NoteList,
  OutputHeader,
  PreflightPanel,
  ScanButton,
  VerifyFindings,
} from "@/components/ReportSections";

function defaultStartDate() {
  const date = new Date();
  date.setMonth(date.getMonth() - 4, 1);
  return date.toISOString().split("T")[0];
}

export default function HealthScore({ settings, onSettingsClick }) {
  const [rangeStart, setRangeStart] = useState(defaultStartDate);
  const [rangeEnd, setRangeEnd] = useState(TODAY);
  const [hasPriorDeck, setHasPriorDeck] = useState(false);
  const [priorDeck, setPriorDeck] = useState(null);
  const [deckLoading, setDeckLoading] = useState(false);
  const [deckError, setDeckError] = useState("");
  const [reviewTranscriptFilename, setReviewTranscriptFilename] = useState("");

  const wf = useReportWorkflow({
    settings,
    storageKey: "report:health-score",
    saveTitle: (account) => `${account?.name || "Account"} Customer Success Health ${TODAY}`,
    strictFolderOnlyDefault: true,
    allowExternalSources: false,
    buildNotesParams: (params) => {
      params.set("startDate", rangeStart);
      params.set("endDate", rangeEnd);
    },
    synthesizeExtras: () => ({
      promptType: "health-score",
      rangeStart,
      rangeEnd,
      previousDeckText: priorDeck?.text || "",
      previousDeckName: priorDeck?.filename || "",
      reviewTranscriptFilename,
    }),
  });

  const account = detectAccount(wf.selectedFolder, settings.accounts);
  const accountReady = wf.selectedFolder && account.name !== "Internal";
  const transcriptOptions = useMemo(() => {
    const notes = wf.activeNotes || [];
    return [...notes].sort((a, b) => {
      const aReview = /review|score|qbr|ebr|health|quarter/i.test(`${a.title} ${a.filename}`) ? 1 : 0;
      const bReview = /review|score|qbr|ebr|health|quarter/i.test(`${b.title} ${b.filename}`) ? 1 : 0;
      return bReview - aReview || String(b.date).localeCompare(String(a.date));
    });
  }, [wf.activeNotes]);

  const scrub = {
    scrubReport: wf.scrubReport,
    restoredIds: wf.restoredIds,
    setRestoredIds: wf.setRestoredIds,
    open: wf.scrubOpen,
    setOpen: wf.setScrubOpen,
  };

  function selectFolder(folder) {
    wf.selectFolder(folder);
    setPriorDeck(null);
    setDeckError("");
    setReviewTranscriptFilename("");
  }

  async function readPriorDeck(file) {
    if (!file) return;
    setDeckLoading(true);
    setDeckError("");
    setPriorDeck(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await apiFetch("/api/pdf-text", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read the PDF.");
      setPriorDeck(data);
    } catch (error) {
      setDeckError(error.message);
    } finally {
      setDeckLoading(false);
    }
  }

  const canGenerate = accountReady
    && wf.activeNotes?.length > 0
    && (!hasPriorDeck || !!priorDeck)
    && !deckLoading;

  return (
    <div className="space-y-4">
      <div className="card p-6 border-l-4 border-l-obsidian-600">
        <h1 className="text-lg font-semibold text-gray-900">Generate Health Score</h1>
        <p className="text-sm text-gray-600 mt-1">
          Build an evidence-based Customer Success health score for one account. This workflow reads only the selected folder and removes configured identifiers for every other account before generation.
        </p>
      </div>

      <FolderSelector
        vaultPath={settings.vaultPath}
        selectedFolder={wf.selectedFolder}
        onSelect={selectFolder}
        onSettingsClick={onSettingsClick}
        stepNumber={1}
        title="Account Folder"
        description="This folder is the full evidence boundary for the health score"
      />

      {wf.selectedFolder && !accountReady && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          This folder does not match an account in Settings. Add the account name or folder alias before generating so isolation rules can be enforced.
        </p>
      )}

      {accountReady && !wf.output && (
        <div className="card p-6 space-y-5">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Evidence Window</h2>
                <p className="text-xs text-gray-500 mt-0.5">Only dated Markdown notes inside {wf.selectedFolder} are scanned.</p>
              </div>
              <ScanButton loading={wf.loading} scanned={wf.loadedNotes !== null} onClick={wf.handleLoadNotes} disabled={wf.loading} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              <label className="text-xs font-medium text-gray-600">
                Start date
                <input type="date" className="input mt-1" value={rangeStart} onChange={(event) => { setRangeStart(event.target.value); wf.invalidateNotes(); }} />
              </label>
              <label className="text-xs font-medium text-gray-600">
                As-of date
                <input type="date" className="input mt-1" value={rangeEnd} onChange={(event) => { setRangeEnd(event.target.value); wf.invalidateNotes(); }} />
              </label>
            </div>
          </div>

          {wf.loadError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{wf.loadError}</p>}

          {wf.loadedNotes !== null && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-800">{wf.loadedNotes.length} source note{wf.loadedNotes.length === 1 ? "" : "s"} found</p>
                <CountsBadges counts={wf.loadCounts} />
              </div>
              {wf.loadedNotes.length ? (
                <>
                  <NoteList notes={wf.activeNotes} />
                  {wf.loadedNotes.length > wf.activeNotes.length && (
                    <p className="text-xs text-amber-700 mt-2">
                      {wf.loadedNotes.length - wf.activeNotes.length} note{wf.loadedNotes.length - wf.activeNotes.length === 1 ? " was" : "s were"} excluded because another configured account dominated the content. Health Score does not allow those notes back into this run.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-amber-700">No dated notes were found in this folder for the selected range.</p>
              )}
            </div>
          )}

          <div className="border-t border-gray-100 pt-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Previous Review Context</h2>
              <p className="text-xs text-gray-500 mt-0.5">Both inputs are optional. They preserve continuity without treating old claims as current evidence.</p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={hasPriorDeck}
                onChange={(event) => { setHasPriorDeck(event.target.checked); if (!event.target.checked) { setPriorDeck(null); setDeckError(""); } }}
                className="mt-0.5 w-4 h-4 rounded accent-obsidian-600"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">I have the previous slide deck as a PDF</span>
                <span className="block text-xs text-gray-500 mt-0.5">Used for prior ratings, open commitments, and last-shared wording.</span>
              </span>
            </label>

            {hasPriorDeck && (
              <div className="pl-7">
                <input
                  aria-label="Previous scorecard PDF"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => readPriorDeck(event.target.files?.[0])}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-200"
                />
                {deckLoading && <p className="text-xs text-gray-500 mt-2">Reading PDF text…</p>}
                {priorDeck && (
                  <p className="text-xs text-green-700 mt-2">✓ {priorDeck.filename} · {priorDeck.pages || "?"} pages{priorDeck.truncated ? " · long deck text trimmed to fit" : ""}</p>
                )}
                {deckError && <p className="text-xs text-red-600 mt-2">{deckError}</p>}
              </div>
            )}

            <label className="block text-sm font-medium text-gray-800">
              Prior review transcript from this folder <span className="font-normal text-gray-400">(optional)</span>
              <select
                aria-label="Prior review transcript"
                className="input mt-1"
                value={reviewTranscriptFilename}
                onChange={(event) => setReviewTranscriptFilename(event.target.value)}
                disabled={!transcriptOptions.length}
              >
                <option value="">No transcript selected</option>
                {transcriptOptions.map((note) => (
                  <option key={note.filename} value={note.filename}>{note.date || "Undated"} · {note.title}</option>
                ))}
              </select>
              <span className="block text-xs font-normal text-gray-500 mt-1">Review-like titles are listed first. The selected session is weighted as continuity context.</span>
            </label>
          </div>

          {canGenerate && !wf.showConfirm && (
            <GeneratePanel
              scrub={scrub}
              model={wf.model}
              setModel={wf.setModel}
              synthError={wf.synthError}
              onGenerate={() => wf.setShowConfirm(true)}
              synthesizing={wf.synthesizing}
              buttonLabel="Generate Health Score"
              showScrub={false}
            />
          )}

          {canGenerate && wf.showConfirm && (
            <PreflightPanel
              intro={`${account.name} only. ${wf.activeNotes.length} selected-folder source${wf.activeNotes.length === 1 ? "" : "s"}${priorDeck ? ` plus ${priorDeck.filename}` : ""}${reviewTranscriptFilename ? " plus one selected review transcript" : ""}.`}
              notes={wf.activeNotes}
              loadCounts={wf.loadCounts}
              model={wf.model}
              setModel={wf.setModel}
              scrub={scrub}
              onCancel={() => wf.setShowConfirm(false)}
              onConfirm={() => wf.handleSynthesize()}
              synthesizing={wf.synthesizing}
              confirmLabel="Generate Health Score"
              showScrub={false}
            />
          )}
        </div>
      )}

      {(wf.output || wf.synthesizing) && (
        <div className="space-y-4">
          <OutputHeader
            synthesizing={wf.synthesizing}
            readyTitle={`${account.name} Health Score Ready`}
            onReset={wf.handleReset}
            droppedCount={wf.droppedCount}
            restoredFromStorage={wf.restoredFromStorage}
            history={wf.history}
            onOpenHistory={wf.openHistoryItem}
            onVerify={wf.handleVerifyReport}
            verifying={wf.verifying}
            verifyDisabled={!wf.activeNotes?.length}
          />
          <VerifyFindings findings={wf.verifyFindings} />
          <BleedWarning output={wf.output} accountName={account.name} allAccounts={settings.accounts || []} streaming={wf.synthesizing} redactedCount={wf.redactedCount} />
          {wf.partial && wf.synthError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{wf.synthError}</p>}
          {wf.output && (
            <NotesPreview
              notes={wf.output}
              onNotesChange={wf.handleOutputChange}
              onSave={() => wf.handleSave()}
              saving={wf.saving}
              saved={wf.saved}
              savedPath={wf.savedPath}
              cost={wf.synthCost}
              streaming={wf.synthesizing}
              onCancel={wf.handleCancelSynthesis}
              onRetry={wf.handleRetrySynthesis}
              canRetry={!!wf.lastSynthesisRequest && !wf.synthesizing}
            />
          )}
          {wf.synthesizing && !wf.output && <div className="card p-6 text-sm text-gray-500 animate-pulse">Building the account health score…</div>}
        </div>
      )}
    </div>
  );
}
