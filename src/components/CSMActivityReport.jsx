"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FolderSelector from "@/components/FolderSelector";
import ActivityPreview from "@/components/ActivityPreview";
import ActivityImprovementPanel from "@/components/ActivityImprovementPanel";
import ActivityComparisonPanel from "@/components/ActivityComparisonPanel";
import RunModePicker from "@/components/RunModePicker";
import DraftRestoreList from "@/components/DraftRestoreList";
import { calcCost, defaultReviewModel, estimateUsage, providerLabel, resolveAutoModel } from "@/lib/models";
import { applyImprovement } from "@/lib/activityImprovement";
import { acceptActivityAlternative } from "@/lib/activityComparison";
import { detectAccount, suggestAgreements } from "@/lib/accounts";
import { reverseReplacements } from "@/lib/sanitize";
import { redactForbiddenTerms } from "@/lib/scrub";
import { apiFetch } from "@/lib/apiClient";
import { useReportWorkflow, TODAY } from "@/hooks/useReportWorkflow";
import { ScanButton, CountsBadges, NoteList, GeneratePanel, PreflightPanel, OutputHeader, HistoryMenu, BleedWarning, StrictToggle } from "@/components/ReportSections";
import { parseActivityRows, rowsToNDJSON, rowsToMarkdown, sortRowsByDate } from "@/lib/activityRows";
import { harvestNotes } from "@/lib/sfdcHarvest";
import { fixActivityRow, lintActivityRow, lintSummary } from "@/lib/activityLint";
import { reviewActivityPortfolio } from "@/lib/activityPortfolio";
import { isFiled, loadFiledRows, markFiled, recentFiledRows } from "@/lib/filedRows";
import { consumeSseText } from "@/lib/sseClient";

function toISO(d) {
  return d.toISOString().split("T")[0];
}

function defaultRangeStart() {
  const d = new Date();
  d.setMonth(d.getMonth() - 4);
  return toISO(d);
}

// NI fiscal year starts in October; FY is named for the year it ends in
// (FY26 = Oct 2025 – Sep 2026). Q1 = Oct–Dec, Q2 = Jan–Mar, Q3 = Apr–Jun,
// Q4 = Jul–Sep. Current fiscal quarter plus the three before it, newest first.
const FY_START_MONTH = 9; // October, 0-indexed

function quarterPresets() {
  const now = new Date();
  let fy = now.getFullYear() + (now.getMonth() >= FY_START_MONTH ? 1 : 0);
  let q = Math.floor(((now.getMonth() - FY_START_MONTH + 12) % 12) / 3); // 0..3
  const presets = [];
  for (let i = 0; i < 4; i++) {
    const startMonth = FY_START_MONTH + q * 3; // months past Jan of fy-1; may exceed 11
    presets.push({
      label: `Q${q + 1} FY${String(fy).slice(2)}`,
      start: toISO(new Date(fy - 1, startMonth, 1)),
      end: toISO(new Date(fy - 1, startMonth + 3, 0)),
    });
    q--;
    if (q < 0) { q = 3; fy--; }
  }
  return presets;
}

function prettyDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// Candidate account-identifying terms in a row's text (capitalized sequences),
// used to prefill the bleed-feedback panel.
const GENERIC = new Set(["CSM", "FAE", "The", "This", "That", "Region", "Attendees", "Outcome", "Type", "Subtype", "NI", "EA", "ROI", "QBR", "EBR", "SLE", "SLS", "LabVIEW", "TestStand", "SystemLink", "Python", "Linux"]);

function extractCandidateTerms(row, ownTerms) {
  const text = `${row.title} ${row.comments}`;
  const own = new Set((ownTerms || []).map((t) => t.toLowerCase()));
  const found = new Set();
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z0-9'-]{2,}(?:\s+[A-Z][a-zA-Z0-9'-]{2,}){0,2})\b/g)) {
    const t = m[1];
    if (GENERIC.has(t) || own.has(t.toLowerCase())) continue;
    if (t.split(/\s+/).every((w) => GENERIC.has(w))) continue;
    found.add(t);
  }
  return [...found].slice(0, 6);
}

export default function CSMActivityReport({ settings, onSettingsClick, onAccountsUpdate }) {
  const [improvementSession, setImprovementSession] = useState(0);
  const [runMode, setRunMode] = useState("quick");
  // null = "follow the primary model's usual alternate provider"; once the
  // CSM picks a reviewer explicitly (RunModePicker), that choice sticks even
  // if the primary model changes later.
  const [reviewModelOverride, setReviewModelOverride] = useState(null);
  const [pendingImprovement, setPendingImprovement] = useState(false);
  const [pendingAlternative, setPendingAlternative] = useState(false);
  const [pendingFlaggedReview, setPendingFlaggedReview] = useState(false);
  const [pendingPrimaryRecord, setPendingPrimaryRecord] = useState(false);
  const [alternativeRows, setAlternativeRows] = useState(null);
  const [alternativeLoading, setAlternativeLoading] = useState(false);
  const [alternativeError, setAlternativeError] = useState("");
  const [alternativeMeta, setAlternativeMeta] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [draftHistory, setDraftHistory] = useState([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [rangeStart, setRangeStart] = useState(defaultRangeStart());
  const [rangeEnd, setRangeEnd] = useState(TODAY);
  const [verifying, setVerifying] = useState(false);
  const [verifyingRow, setVerifyingRow] = useState(null);
  const [bleedRow, setBleedRow] = useState(null); // row index being flagged
  const [bleedAccount, setBleedAccount] = useState("");
  const [bleedTerms, setBleedTerms] = useState("");
  const [filedMap, setFiledMap] = useState({});
  const [regeneratingRow, setRegeneratingRow] = useState(null);
  const [includeInternal, setIncludeInternal] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [pendingClassifyCheck, setPendingClassifyCheck] = useState(false);
  const [reportFiled, setReportFiled] = useState(null); // { filename, count } from the folder's latest saved report
  const manualEditRef = useRef({ timer: null, active: false });

  useEffect(() => () => clearTimeout(manualEditRef.current.timer), []);

  useEffect(() => {
    setFiledMap(loadFiledRows());
  }, []);

  const wf = useReportWorkflow({
    settings,
    storageKey: "report:ea-activity",
    saveTitle: () => `EA Activity Report ${TODAY}`,
    buildNotesParams: (params) => {
      params.set("startDate", rangeStart);
      params.set("endDate", rangeEnd);
    },
    synthesizeExtras: () => ({ promptType: "csm-activity", rangeStart, rangeEnd, exampleRows: recentFiledRows(filedMap) }),
    // Saved reports live in the same folder as the notes; they are output,
    // not source material.
    filterNotes: (n) => !/^EA Activity Report\b/i.test(n.title || ""),
  });

  // The folder's most recent saved report is the durable record of what was
  // filed — ticks made there (in the app or by editing the table in Obsidian)
  // carry into this run, on any machine.
  useEffect(() => {
    if (!settings.vaultPath || wf.selectedFolder === undefined) return;
    let canceled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ vaultPath: settings.vaultPath, folderPath: wf.selectedFolder || "" });
        const res = await apiFetch(`/api/ea-report-filed?${params}`);
        const data = await res.json();
        if (canceled || !res.ok || !data.report) {
          if (!canceled) setReportFiled(null);
          return;
        }
        const filedRows = (data.rows || []).filter((r) => r.filed);
        if (filedRows.length) {
          setFiledMap((prev) => filedRows.reduce((map, row) => (isFiled(map, row) ? map : markFiled(map, row, true)), prev));
        }
        setReportFiled({ filename: data.report.filename, count: filedRows.length, total: (data.rows || []).length });
      } catch {
        if (!canceled) setReportFiled(null);
      }
    })();
    return () => { canceled = true; };
  }, [settings.vaultPath, wf.selectedFolder]);

  const accountName = detectAccount(wf.selectedFolder, settings.accounts).name;
  const account = (settings.accounts || []).find((a) => a.name === accountName) || null;
  const reportHistoryKey = `report:ea-activity:drafts:${settings.vaultPath || "default"}:${wf.selectedFolder || "root"}`;
  const resolvedReportModel = resolveAutoModel(wf.model, { apiKey: settings.apiKey, openaiApiKey: settings.openaiApiKey });
  // The reviewer for every cross-check on this tab (classification check,
  // verify vs sources, improve activities, compare report) — user-chosen via
  // RunModePicker, defaulting to the usual alternate provider.
  const reviewModel = reviewModelOverride || defaultReviewModel(resolvedReportModel, settings);
  const estimatedReportCost = estimateUsage(wf.activeNotes || [], resolvedReportModel, 3500).cost;
  const estimatedAlternateReportCost = estimateUsage(wf.activeNotes || [], reviewModel, 3500).cost;

  useEffect(() => {
    setHistoryReady(false);
    try { setDraftHistory(JSON.parse(localStorage.getItem(reportHistoryKey) || "[]")); } catch { setDraftHistory([]); }
    setHistoryReady(true);
  }, [reportHistoryKey]);
  useEffect(() => {
    if (!historyReady) return;
    try { localStorage.setItem(reportHistoryKey, JSON.stringify(draftHistory.slice(0, 15))); } catch {}
  }, [draftHistory, historyReady, reportHistoryKey]);

  // Notes whose saved SFDC entry can be used as-is vs. notes Claude must read.
  const agreementsOnFile = !!((settings.accounts || []).find((a) => a.name === detectAccount(wf.selectedFolder, settings.accounts).name)?.agreements || [])
    .some((g) => String(g?.number || "").trim());
  const harvestPlan = useMemo(
    () => harvestNotes(wf.activeNotes || [], { ownerNames: settings.ownerNames || [], skipInternalCheckIns: !includeInternal, agreementsOnFile }),
    [wf.activeNotes, settings.ownerNames, includeInternal, agreementsOnFile]
  );

  const findSourceNote = (row) => {
    const wanted = (row?.sourceTitle || "").toLowerCase();
    if (!wanted) return null;
    return (wf.loadedNotes || []).find((n) => {
      const t = (n.title || "").toLowerCase();
      return t === wanted || t.includes(wanted) || wanted.includes(t);
    }) || null;
  };

  // Rows are newest-first and decorated with filed state and, for generated
  // rows, the EA/EP number(s) matched from the source note's keywords.
  // Every row — harvested or generated — is linted on the way in, so what
  // the table shows is what would actually post.
  const rows = useMemo(() => {
    return sortRowsByDate(parseActivityRows(wf.output)).map((row) => {
      let agreement = row.agreement;
      if (!agreement && row.origin !== "note" && account) {
        const note = findSourceNote(row);
        if (note) agreement = suggestAgreements(note.content || "", account).map((g) => `${g.type} ${g.number}`).join(", ");
      }
      const decorated = { ...row, agreement, filed: isFiled(filedMap, row) };
      return { ...decorated, lint: lintActivityRow(decorated, { ownerNames: settings.ownerNames || [], agreementsOnFile }) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf.output, filedMap, account, wf.loadedNotes, settings.ownerNames, agreementsOnFile]);
  const issueSummary = useMemo(() => lintSummary(rows), [rows]);
  const portfolio = useMemo(() => reviewActivityPortfolio(rows, { rangeStart, rangeEnd }), [rows, rangeStart, rangeEnd]);

  // The safe fixes for every unfiled row at once — the CSM's name to "CSM",
  // markers out, empty fragments out, title noise off. One undo step.
  function fixSafeIssues() {
    let changed = 0;
    const next = rows.map((row) => {
      if (row.filed) return row;
      const result = fixActivityRow(row, { ownerNames: settings.ownerNames || [] });
      if (!result.changed) return row;
      changed += 1;
      return result.row;
    });
    if (changed) commitRows(next, `Fixed safe issues in ${changed} row${changed !== 1 ? "s" : ""}`);
  }

  // note title (lowercased) -> origin, so the table can badge cross-folder sources
  const sourceInfo = useMemo(() => {
    const map = {};
    for (const n of wf.loadedNotes || []) {
      map[(n.title || "").toLowerCase()] = { source: n.source, sourceLabel: n.sourceLabel };
    }
    return map;
  }, [wf.loadedNotes]);

  function recordReportDraft(output, label, draftModel = wf.model, cost = null) {
    if (!output?.trim()) return;
    const entry = { id: `${Date.now()}-${Math.random()}`, output, label, model: draftModel, cost, sourceCount: wf.activeNotes?.length || 0, ts: Date.now() };
    setDraftHistory((history) => [entry, ...history.filter((item) => item.output !== output)].slice(0, 15));
  }

  function commitRows(next, label, draftModel = wf.model, cost = null) {
    clearTimeout(manualEditRef.current.timer);
    manualEditRef.current.active = false;
    const output = rowsToNDJSON(next);
    if (wf.output?.trim() && output !== wf.output) setUndoStack((stack) => [...stack, wf.output].slice(-15));
    wf.handleOutputChange(output);
    recordReportDraft(output, label, draftModel, cost);
  }

  function undoReport() {
    if (!undoStack.length) return;
    clearTimeout(manualEditRef.current.timer);
    manualEditRef.current.active = false;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    wf.handleOutputChange(previous);
    recordReportDraft(previous, "Undo");
  }

  function restoreReport(entry) {
    if (!entry?.output || entry.output === wf.output) return;
    setUndoStack((stack) => [...stack, wf.output].filter(Boolean).slice(-15));
    wf.handleOutputChange(entry.output);
    recordReportDraft(entry.output, `Restored: ${entry.label}`, entry.model, entry.cost);
  }

  function applyImprovementChanges(changes) {
    const next = applyImprovement(rows, changes);
    // Titles participate in filed-row identity. Carry that state to renamed
    // activities so editing never makes an already-filed activity look new.
    setFiledMap((prev) => changes.reduce((map, { index }) => rows[index].filed ? markFiled(map, next[index], true) : map, prev));
    commitRows(next, `${providerLabel(reviewModel)} improvement`, reviewModel);
  }

  function openReportHistory(item) {
    setImprovementSession((session) => session + 1);
    setPendingImprovement(false);
    setAlternativeRows(null);
    setUndoStack([]);
    wf.invalidateNotes();
    wf.openHistoryItem(item);
  }

  function resetReport() {
    clearTimeout(manualEditRef.current.timer);
    manualEditRef.current.active = false;
    setAlternativeRows(null);
    setAlternativeError("");
    setAlternativeMeta(null);
    setUndoStack([]);
    setPendingPrimaryRecord(true);
    wf.handleReset();
  }

  function updateRow(i, patch) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    if (!manualEditRef.current.active) {
      setUndoStack((stack) => [...stack, wf.output].filter(Boolean).slice(-15));
      manualEditRef.current.active = true;
    }
    clearTimeout(manualEditRef.current.timer);
    const output = rowsToNDJSON(next);
    wf.handleOutputChange(output);
    manualEditRef.current.timer = setTimeout(() => {
      manualEditRef.current.active = false;
      recordReportDraft(output, "Manual row edit");
    }, 800);
  }

  function handleRangeChange(start, end) {
    setRangeStart(start);
    setRangeEnd(end);
    // Loaded notes were fetched for the old range — force a re-scan.
    wf.invalidateNotes();
  }

  // Harvest first, generate second: notes that already carry a reviewed SFDC
  // entry become rows instantly; only the rest go to Claude.
  async function handleGenerate() {
    setPendingImprovement(false);
    setPendingAlternative(false);
    setPendingFlaggedReview(false);
    setAlternativeRows(null);
    setAlternativeError("");
    setUndoStack([]);
    const { rows: harvested, remaining } = harvestPlan;
    wf.seedOutput(rowsToNDJSON(harvested));
    if (remaining.length) await wf.handleSynthesize({ append: harvested.length > 0, notes: remaining });
    // The classification check needs the rows React derives from the new
    // output, so it runs from an effect once the state has settled.
    if (runMode === "second-opinion") setPendingImprovement(true);
    else if (runMode === "compare") setPendingAlternative(true);
    else if (runMode === "flagged") { setPendingClassifyCheck(true); setPendingFlaggedReview(true); }
  }

  async function runAlternativeReport() {
    if (!wf.activeNotes?.length || alternativeLoading) return;
    const comparisonModel = reviewModel;
    setAlternativeLoading(true);
    setAlternativeError("");
    try {
      const response = await apiFetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: wf.activeNotes,
          model: comparisonModel,
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
          today: TODAY,
          replacements: settings.replacements || [],
          corrections: settings.corrections || [],
          accountName,
          allAccounts: settings.accounts || [],
          restoredIds: [...wf.restoredIds],
          promptType: "csm-activity",
          rangeStart,
          rangeEnd,
          exampleRows: recentFiledRows(filedMap),
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Alternative report failed");
      }
      const result = await consumeSseText(response);
      const restored = (settings.replacements || []).length ? reverseReplacements(result.text, settings.replacements || []) : result.text;
      const clean = redactForbiddenTerms(restored, accountName, settings.accounts || []).text;
      const parsed = parseActivityRows(clean);
      if (!parsed.length) throw new Error("The alternative provider returned no valid activities.");
      const cost = result.usage ? calcCost(result.usage, comparisonModel) : null;
      setAlternativeRows(parsed);
      setAlternativeMeta({ model: comparisonModel, cost });
      recordReportDraft(rowsToNDJSON(parsed), `${providerLabel(comparisonModel)} independent draft`, comparisonModel, cost);
    } catch (error) {
      setAlternativeError(error.message);
    } finally {
      setAlternativeLoading(false);
    }
  }

  useEffect(() => {
    if (!pendingPrimaryRecord || wf.synthesizing || !rows.length) return;
    setPendingPrimaryRecord(false);
    recordReportDraft(wf.output, `${providerLabel(resolvedReportModel)} primary report`, resolvedReportModel, wf.synthCost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrimaryRecord, wf.synthesizing, rows.length]);

  useEffect(() => {
    if (!pendingAlternative || wf.synthesizing || !rows.length) return;
    setPendingAlternative(false);
    runAlternativeReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAlternative, wf.synthesizing, rows.length]);

  function applyAlternativeItem(item, field) {
    commitRows(acceptActivityAlternative(rows, alternativeRows || [], item, field), field ? `Accepted alternative ${field}` : "Accepted alternative activity", alternativeMeta?.model, alternativeMeta?.cost);
  }

  useEffect(() => {
    if (!pendingClassifyCheck || wf.synthesizing) return;
    setPendingClassifyCheck(false);
    if (rows.length) checkClassifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingClassifyCheck, wf.synthesizing, rows.length]);

  // Second opinion on every row's Type/Subtype from the detailed taxonomy.
  // Produces suggestions the CSM applies or dismisses — never silent edits.
  async function checkClassifications(overrideModel = reviewModel) {
    if (!rows.length) return;
    setClassifying(true);
    const reps = settings.replacements || [];
    try {
      const res = await apiFetch("/api/classify-rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map(({ title, type, subtype, comments }) => ({ title, type, subtype, comments })),
          replacements: reps,
          corrections: settings.corrections || [],
          model: overrideModel,
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Classification check failed");
      const byIndex = new Map((data.suggestions || []).map((s) => [s.index, s]));
      const checked = rows.map((row, i) => {
        const s = byIndex.get(i);
        if (!s) return { ...row, suggestedType: "", suggestedSubtype: "", suggestReason: "" };
        return {
          ...row,
          suggestedType: s.type,
          suggestedSubtype: s.subtype,
          suggestReason: reps.length ? reverseReplacements(s.reason || "", reps) : s.reason || "",
        };
      });
      commitRows(checked, `${providerLabel(overrideModel)} classification review`, overrideModel);
    } catch (e) {
      // No API key or a transient failure: the table is still complete
      // without suggestions, so don't interrupt the CSM.
      console.warn("Classification check skipped:", e.message);
    } finally {
      setClassifying(false);
    }
  }

  function applySuggestion(i) {
    const row = rows[i];
    if (!row?.suggestedType) return;
    updateRow(i, {
      type: row.suggestedType,
      subtype: row.suggestedSubtype,
      suggestedType: "",
      suggestedSubtype: "",
      suggestReason: "",
      review: false,
      reviewReason: "",
    });
  }

  function dismissSuggestion(i) {
    updateRow(i, { suggestedType: "", suggestedSubtype: "", suggestReason: "" });
  }

  function handleResume() {
    wf.handleSynthesize({
      append: true,
      notes: harvestPlan.remaining.length ? harvestPlan.remaining : undefined,
      extraBody: { resumeRows: rows.map(({ eventDate, title }) => ({ eventDate, title })) },
    });
  }

  function toggleFiled(i) {
    const row = rows[i];
    if (!row) return;
    setFiledMap((prev) => markFiled(prev, row, !row.filed));
  }

  // Redo one row: send just its source note back through the classifier and
  // swap the result in place of the old row.
  async function regenerateRow(i) {
    const row = rows[i];
    const note = row && findSourceNote(row);
    if (!note) {
      alert("The source note for this row isn't loaded — re-scan the folder first.");
      return;
    }
    setRegeneratingRow(i);
    const reps = settings.replacements || [];
    try {
      const res = await apiFetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: [note],
          model: wf.model,
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
          today: TODAY,
          replacements: reps,
          corrections: settings.corrections || [],
          accountName,
          allAccounts: settings.accounts || [],
          restoredIds: [...wf.restoredIds],
          promptType: "csm-activity",
          rangeStart,
          rangeEnd,
          exampleRows: recentFiledRows(filedMap),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Regeneration failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const evt = JSON.parse(part.slice(6));
          if (evt.type === "delta") text += evt.text;
          else if (evt.type === "error") throw new Error(evt.message);
        }
      }
      const restored = reps.length ? reverseReplacements(text, reps) : text;
      const fresh = parseActivityRows(redactForbiddenTerms(restored, accountName, settings.accounts || []).text)
        .map((r) => ({ ...r, origin: "generated" }));
      if (!fresh.length) throw new Error("The model returned no rows for this note.");
      commitRows([...rows.slice(0, i), ...fresh, ...rows.slice(i + 1)], `Regenerated activity with ${providerLabel(resolvedReportModel)}`, resolvedReportModel);
    } catch (e) {
      alert(`Regenerate failed: ${e.message}`);
    } finally {
      setRegeneratingRow(null);
    }
  }

  // Second-pass audit of generated rows against their cited sources. Rows
  // harvested from notes were reviewed at save time and are skipped.
  async function handleVerify(indices = null, overrideModel = reviewModel) {
    const selected = indices ? new Set(indices) : null;
    const toVerify = rows.map((row, i) => ({ row, i })).filter(({ row, i }) => selected ? selected.has(i) : row.origin !== "note");
    if (!toVerify.length || !wf.activeNotes?.length) return;
    setVerifying(true);
    setVerifyingRow(indices?.length === 1 ? indices[0] : null);
    try {
      const res = await apiFetch("/api/verify-rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: toVerify.map(({ row }) => row),
          notes: wf.activeNotes,
          accountName,
          allAccounts: settings.accounts || [],
          replacements: settings.replacements || [],
          corrections: settings.corrections || [],
          restoredIds: [...wf.restoredIds],
          model: overrideModel,
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      const reps = settings.replacements || [];
      const verdictByRowIndex = new Map();
      for (const v of data.verdicts || []) {
        const target = toVerify[v.index];
        if (target) verdictByRowIndex.set(target.i, v);
      }
      const next = rows.map((r, i) => {
        const v = verdictByRowIndex.get(i);
        if (!v) return r;
        const restore = (value) => reps.length ? reverseReplacements(value || "", reps) : value || "";
        return { ...r, verify: v.supported ? "passed" : "failed", verifyReason: restore(v.reason), verifySource: restore(v.sourceTitle), verifyEvidence: restore(v.evidenceQuote) };
      });
      commitRows(next, `${providerLabel(overrideModel)} source check`, overrideModel);
    } catch (e) {
      alert(`Verification failed: ${e.message}`);
    } finally {
      setVerifying(false);
      setVerifyingRow(null);
    }
  }

  useEffect(() => {
    if (!pendingFlaggedReview || pendingClassifyCheck || classifying || wf.synthesizing) return;
    setPendingFlaggedReview(false);
    const flagged = rows.map((row, index) => row.review || row.suggestedType ? index : -1).filter((index) => index >= 0);
    if (flagged.length) handleVerify(flagged, reviewModel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFlaggedReview, pendingClassifyCheck, classifying, wf.synthesizing]);

  // Bleed feedback: user marks a row as another account's content.
  function openBleedPanel(i) {
    const row = rows[i];
    const ownTerms = (settings.accounts || [])
      .filter((a) => a.name === accountName)
      .flatMap((a) => [a.name, ...(a.aliases || []), ...(a.keywords || [])]);
    setBleedRow(i);
    setBleedAccount("");
    setBleedTerms(extractCandidateTerms(row, ownTerms).join(", "));
  }

  function confirmBleed() {
    const terms = bleedTerms.split(",").map((s) => s.trim()).filter(Boolean);
    if (bleedAccount && terms.length && onAccountsUpdate) {
      const nextAccounts = (settings.accounts || []).map((a) => {
        if (a.name !== bleedAccount) return a;
        const existing = (a.keywords || []).map((k) => k.toLowerCase());
        return { ...a, keywords: [...(a.keywords || []), ...terms.filter((t) => !existing.includes(t.toLowerCase()))] };
      });
      onAccountsUpdate(nextAccounts);
    }
    // Remove the misattributed row regardless.
    commitRows(rows.filter((_, idx) => idx !== bleedRow), "Removed misattributed activity");
    setBleedRow(null);
  }

  const otherAccounts = (settings.accounts || []).filter((a) => a.name !== accountName && a.name !== "Internal");
  const scrub = { scrubReport: wf.scrubReport, restoredIds: wf.restoredIds, setRestoredIds: wf.setRestoredIds, open: wf.scrubOpen, setOpen: wf.setScrubOpen };
  const folderLabel = wf.selectedFolder || "(Vault root)";

  return (
    <div className="space-y-4">
      <FolderSelector
        vaultPath={settings.vaultPath}
        selectedFolder={wf.selectedFolder}
        onSelect={wf.selectFolder}
        onSettingsClick={onSettingsClick}
      />

      {settings.vaultPath && !wf.output && (
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h3 className="text-base font-semibold text-gray-900">EA Activity Report</h3>
                <HistoryMenu history={wf.history} onOpen={openReportHistory} />
              </div>
              <p className="text-sm text-gray-500">
                Scanning <span className="font-medium text-gray-700">{folderLabel}</span> for notes dated{" "}
                <span className="font-medium text-gray-700">{prettyDate(rangeStart)}</span> through{" "}
                <span className="font-medium text-gray-700">{prettyDate(rangeEnd)}</span>, then generating a CSM activity table.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={rangeStart}
                  max={rangeEnd}
                  onChange={(e) => handleRangeChange(e.target.value, rangeEnd)}
                  className="input !w-auto text-xs py-1.5"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={rangeEnd}
                  min={rangeStart}
                  onChange={(e) => handleRangeChange(rangeStart, e.target.value)}
                  className="input !w-auto text-xs py-1.5"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {quarterPresets().map((p) => {
                    const active = rangeStart === p.start && rangeEnd === p.end;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => handleRangeChange(p.start, p.end)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          active
                            ? "bg-obsidian-600 text-white border-obsidian-600"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => handleRangeChange(defaultRangeStart(), TODAY)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      rangeStart === defaultRangeStart() && rangeEnd === TODAY
                        ? "bg-obsidian-600 text-white border-obsidian-600"
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    Last 4 months
                  </button>
                </div>
              </div>

              {wf.loadedNotes !== null && (
                <div className="mt-3">
                  {wf.loadedNotes.length === 0 ? (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200 inline-block">
                      No notes found in this folder for the selected date range.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-green-700">
                        Found {wf.loadedNotes.length} note{wf.loadedNotes.length !== 1 ? "s" : ""} in the selected range
                      </p>
                      <CountsBadges counts={wf.loadCounts} />
                      <NoteList notes={wf.loadedNotes} excludedFiles={wf.excludedFiles} onToggle={wf.toggleNoteExcluded} noteRisks={wf.noteRisks} />
                    </div>
                  )}
                </div>
              )}

              {wf.loadError && <p className="mt-2 text-sm text-red-600">{wf.loadError}</p>}
            </div>

            <div className="flex flex-col items-end">
              <ScanButton loading={wf.loading} scanned={wf.loadedNotes !== null} onClick={wf.handleLoadNotes} disabled={wf.loading || !settings.vaultPath} />
              <StrictToggle strict={wf.strictFolderOnly} setStrict={wf.setStrictFolderOnly} disabled={wf.loading} />
            </div>
          </div>

          <div className="mt-4"><DraftRestoreList entries={draftHistory} onRestore={restoreReport} title="Recent EA report drafts" /></div>
          {wf.activeNotes?.length > 0 && <div className="mt-4"><RunModePicker value={runMode} onChange={setRunMode} estimatedCost={estimatedReportCost} alternateEstimatedCost={estimatedAlternateReportCost} model={resolvedReportModel} reviewModel={reviewModel} onReviewModelChange={setReviewModelOverride} settings={settings} allowFlagged disabled={wf.synthesizing} /></div>}
          {wf.activeNotes?.length > 0 && !wf.showConfirm && (
            <GeneratePanel
              scrub={scrub}
              model={wf.model}
              setModel={wf.setModel}
              synthError={wf.synthError}
              onGenerate={() => wf.setShowConfirm(true)}
              synthesizing={wf.synthesizing}
              buttonLabel="Generate EA Activity Report"
            />
          )}

          {wf.activeNotes?.length > 0 && wf.showConfirm && (
            <PreflightPanel
              intro={
                <>
                  {harvestPlan.remaining.length === 0 ? (
                    <>All <strong>{harvestPlan.rows.length}</strong> usable notes already carry a reviewed SFDC Activity Entry — the table is built straight from those. {runMode === "second-opinion" ? `Then ${providerLabel(reviewModel)} reviews all activities against the source notes.` : runMode === "compare" ? `Then ${providerLabel(reviewModel)} independently builds a second report for comparison.` : runMode === "flagged" ? `Then ${providerLabel(reviewModel)} reviews uncertain classifications and checks flagged rows against the source notes.` : "No second model pass will run."}</>
                  ) : (
                    <>
                      <strong>{harvestPlan.rows.length}</strong> note{harvestPlan.rows.length !== 1 ? "s" : ""} already carr{harvestPlan.rows.length !== 1 ? "y" : "ies"} a reviewed SFDC Activity Entry and will be used as-is.
                      Sending the other <strong>{harvestPlan.remaining.length}</strong> note{harvestPlan.remaining.length !== 1 ? "s" : ""} (no entry) to {providerLabel(resolvedReportModel)} to classify. {runMode === "second-opinion" && `Then ${providerLabel(reviewModel)} reviews the full table and source notes.`}{runMode === "compare" && ` Then ${providerLabel(reviewModel)} independently generates a comparison report.`}
                    </>
                  )}
                  {harvestPlan.skipped.length > 0 && (
                    <span className="block mt-2 text-xs text-gray-500">
                      Skipping {harvestPlan.skipped.length}: {harvestPlan.skipped.map((s) => `${s.title} (${s.reason})`).join("; ")}.
                    </span>
                  )}
                  {(harvestPlan.skipped.some((s) => s.reason === "internal check-in" || s.reason.startsWith("not reportable")) || includeInternal) && (
                    <label className="block mt-1 text-xs text-gray-500 cursor-pointer">
                      <input type="checkbox" className="mr-1 align-middle" checked={includeInternal} onChange={(e) => setIncludeInternal(e.target.checked)} />
                      Include notes marked not reportable (1:1s, team meetings, internal syncs) in this report
                    </label>
                  )}
                </>
              }
              notes={harvestPlan.remaining.length ? harvestPlan.remaining : wf.activeNotes}
              loadCounts={wf.loadCounts}
              model={wf.model}
              setModel={wf.setModel}
              scrub={scrub}
              onCancel={() => wf.setShowConfirm(false)}
              onConfirm={handleGenerate}
              synthesizing={wf.synthesizing}
              confirmLabel={runMode === "second-opinion" ? "Build table & get second opinion" : runMode === "compare" ? "Build & compare both providers" : runMode === "flagged" ? "Build & review flagged items" : harvestPlan.remaining.length === 0 ? "Build table from notes" : `Confirm — Send to ${providerLabel(resolvedReportModel)}`}
            />
          )}
        </div>
      )}

      {(wf.output || wf.synthesizing) && (
        <div className="space-y-4">
          <OutputHeader
            synthesizing={wf.synthesizing}
            readyTitle="EA Activity Report Ready"
            onReset={resetReport}
            droppedCount={wf.droppedCount}
            restoredFromStorage={wf.restoredFromStorage}
            history={wf.history}
            onOpenHistory={openReportHistory}
          />
          {wf.partial && !wf.synthesizing && (
            <div className="flex items-center justify-between gap-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span>{wf.synthError || "Generation stopped early — partial output kept."}</span>
              {wf.activeNotes?.length ? (
                <button onClick={handleResume} className="btn-secondary text-xs px-3 py-1 whitespace-nowrap">
                  Resume generation
                </button>
              ) : (
                <span className="text-gray-500 whitespace-nowrap">Re-scan the folder to resume.</span>
              )}
            </div>
          )}
          <BleedWarning
            output={wf.output}
            accountName={detectAccount(wf.selectedFolder, settings.accounts).name}
            allAccounts={settings.accounts || []}
            streaming={wf.synthesizing}
            redactedCount={wf.redactedCount}
          />
          {bleedRow !== null && rows[bleedRow] && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-red-800">
                Flag bleed: "{rows[bleedRow].title}"
              </p>
              <p className="text-xs text-red-700">
                Which account does this actually belong to? The terms below will be added to that
                account's keywords so future reports scrub and redact them automatically. The row is removed either way.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={bleedAccount}
                  onChange={(e) => setBleedAccount(e.target.value)}
                  className="input !w-auto text-xs py-1.5"
                >
                  <option value="">(don't add keywords)</option>
                  {otherAccounts.map((a) => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={bleedTerms}
                  onChange={(e) => setBleedTerms(e.target.value)}
                  placeholder="Terms to add as keywords, comma-separated"
                  className="input flex-1 text-xs py-1.5 min-w-48"
                />
                <button onClick={confirmBleed} className="btn-primary text-xs px-3 py-1.5">
                  {bleedAccount ? "Add keywords & remove row" : "Remove row"}
                </button>
                <button onClick={() => setBleedRow(null)} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
              </div>
            </div>
          )}
          {wf.output && reportFiled && (
            <p className="text-xs text-gray-500 -mb-2">
              Filed status loaded from <code className="font-mono">{reportFiled.filename}</code>
              {reportFiled.count
                ? <> — {reportFiled.count} of {reportFiled.total} row{reportFiled.total !== 1 ? "s" : ""} marked filed there.</>
                : <> — no rows marked filed there yet. Tick the Filed box here, or edit <code className="font-mono">[ ]</code> to <code className="font-mono">[x]</code> in Obsidian.</>}
            </p>
          )}
          {rows.length > 0 && !wf.synthesizing && (
            <ActivityComparisonPanel
              current={rows}
              alternative={alternativeRows}
              loading={alternativeLoading}
              error={alternativeError}
              model={alternativeMeta?.model}
              cost={alternativeMeta?.cost}
              onRun={runAlternativeReport}
              onApply={applyAlternativeItem}
              onUndo={undoReport}
              canUndo={undoStack.length > 0}
              history={draftHistory}
              onRestore={restoreReport}
              sources={wf.activeNotes || []}
            />
          )}
          {rows.length > 0 && !wf.synthesizing && (
            <ActivityImprovementPanel
              key={`${settings.vaultPath}:${wf.selectedFolder}:${improvementSession}`}
              rows={rows}
              autoRun={pendingImprovement}
              onAutoRun={() => setPendingImprovement(false)}
              notes={wf.activeNotes}
              settings={settings}
              accountName={accountName}
              restoredIds={wf.restoredIds}
              model={reviewModel}
              disabled={classifying || verifying || regeneratingRow !== null || wf.saving}
              onApply={applyImprovementChanges}
            />
          )}
          {wf.output && (
            <ActivityPreview
              rows={rows}
              rawText={wf.output}
              streaming={wf.synthesizing}
              onUpdateRow={updateRow}
              onSave={() => wf.handleSave(rows.length ? rowsToMarkdown(rows) : wf.output)}
              saving={wf.saving}
              saved={wf.saved}
              savedPath={wf.savedPath}
              cost={wf.synthCost}
              sourceInfo={sourceInfo}
              onVerify={handleVerify}
              onVerifyRow={(index) => handleVerify([index], reviewModel)}
              verifying={verifying}
              verifyingRow={verifyingRow}
              onFlagBleed={openBleedPanel}
              onToggleFiled={toggleFiled}
              onRegenerateRow={regenerateRow}
              regeneratingRow={regeneratingRow}
              onCheckClassifications={checkClassifications}
              classifying={classifying}
              onApplySuggestion={applySuggestion}
              onDismissSuggestion={dismissSuggestion}
              issueSummary={issueSummary}
              onFixIssues={fixSafeIssues}
              portfolio={portfolio}
            />
          )}
          {wf.synthesizing && !wf.output && (
            <div className="card p-6 text-sm text-gray-500 animate-pulse">Waiting for {providerLabel(resolvedReportModel)}…</div>
          )}
        </div>
      )}
    </div>
  );
}
