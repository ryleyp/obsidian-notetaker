"use client";

import { useCallback, useState } from "react";
import { applyCorrections, applyReplacements, reverseReplacements } from "@/lib/sanitize";
import { detectAccount, matchVaultFolder } from "@/lib/accounts";
import { apiFetch } from "@/lib/apiClient";
import { formatTranscriptArchive } from "@/lib/sourceBundle";
import { extractItems } from "@/lib/todoItems";
import { noteDateFromTitle, pushTodoistTasks, todoistConfigured, todoistLabelForNote, todoistTaskFromItemLine } from "@/lib/todoist";

// Writing to the vault: the note itself, plus the two best-effort weekly
// side files (todos and the SFDC activity report), plus the transcript-only
// save path.
export function useNoteSaving({ settings, meeting }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const [todosSaved, setTodosSaved] = useState(null);
  const [todoistSaved, setTodoistSaved] = useState(null);
  const [sfdcReportSaved, setSfdcReportSaved] = useState(null);
  const [customerFactsSaved, setCustomerFactsSaved] = useState(null);
  const [updatedExisting, setUpdatedExisting] = useState(false);
  const [backupPath, setBackupPath] = useState("");

  const [savingTranscript, setSavingTranscript] = useState(false);
  const [transcriptSaved, setTranscriptSaved] = useState(false);
  const [transcriptSavedPath, setTranscriptSavedPath] = useState("");

  // When no folder is picked, infer one from the content; fall back to the
  // vault's Internal folder.
  async function resolveAutoFolder(content) {
    const { selectedFolder } = meeting;
    if (!settings.vaultPath || selectedFolder) return selectedFolder;
    try {
      const res = await apiFetch(`/api/folders?vaultPath=${encodeURIComponent(settings.vaultPath)}`);
      const data = await res.json();
      const folders = (data.folders || []).filter((f) => f.path !== "");
      const matched = matchVaultFolder(content, folders, settings.accounts);
      if (matched) return matched;
      const internal = folders.find((f) => f.name.toLowerCase().includes("internal"));
      return internal?.path || "";
    } catch {
      return selectedFolder;
    }
  }

  const clearSaved = useCallback(() => {
    setSaved(false);
    setSavedPath("");
    setTodosSaved(null);
    setTodoistSaved(null);
    setSfdcReportSaved(null);
    setCustomerFactsSaved(null);
    setUpdatedExisting(false);
    setBackupPath("");
  }, []);

  async function saveNote(notes) {
    const { meetingTitle, existingNote } = meeting;
    if (!notes || !settings.vaultPath) return;
    setSaving(true);
    try {
      const folderPath = existingNote
        ? meeting.selectedFolder
        : await resolveAutoFolder(`${meetingTitle} ${notes}`);
      const res = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes,
          vaultPath: settings.vaultPath,
          folderPath,
          meetingTitle,
          existingRelativePath: existingNote?.relativePath || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaved(true);
      setSavedPath(data.savedPath);
      setUpdatedExisting(!!data.updated);
      setBackupPath(data.backupPath || "");

      // Rebuild the stable customer facts/callouts note from every meeting in
      // the folder. This is a full rebuild, so migrated meetings replace their
      // old contribution instead of creating duplicate callouts.
      const account = detectAccount(folderPath, settings.accounts || []);
      if (account.name !== "Internal") {
        try {
          const factsRes = await apiFetch("/api/customer-facts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              vaultPath: settings.vaultPath,
              folderPath,
              accountName: account.name,
            }),
          });
          const factsData = await factsRes.json();
          if (factsRes.ok && factsData.savedPath) {
            setCustomerFactsSaved({ path: factsData.savedPath, sourceCount: factsData.sourceCount });
          }
        } catch {
          // Best-effort index refresh; the meeting note itself is already safe.
        }
      }

      // Append this note's action items to the weekly todos file.
      // Migrations skip append-only side files to avoid duplicating historical
      // ToDos or SFDC entries when an old transcript is rerun.
      if (!existingNote) {
        try {
          const todosRes = await apiFetch("/api/todos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              notes,
              vaultPath: settings.vaultPath,
              meetingTitle,
              ownerNames: settings.ownerNames || [],
            }),
          });
          const todosData = await todosRes.json();
          if (todosData.count > 0) setTodosSaved({ count: todosData.count, path: todosData.savedPath });
        } catch {
          // Todos extraction is best-effort.
        }
      }

      // Push the CSM's own action items to Todoist, labeled by account folder.
      // Migrations skip this like the other append-only side effects.
      if (!existingNote && todoistConfigured(settings)) {
        try {
          const { actionItems } = extractItems(notes, settings.ownerNames || []);
          const label = todoistLabelForNote(folderPath, settings.accounts);
          const tasks = actionItems
            .map((line) => todoistTaskFromItemLine(line, { noteTitle: meetingTitle, label, noteDate: noteDateFromTitle(meetingTitle) }))
            .filter(Boolean);
          if (tasks.length) {
            const result = await pushTodoistTasks(apiFetch, settings, tasks);
            setTodoistSaved({ count: result?.count || 0, failed: result?.failed?.length || 0 });
          }
        } catch (todoistError) {
          setTodoistSaved({ count: 0, failed: 0, error: todoistError.message });
        }
      }

      // Append the SFDC Activity Entry to this week's report file.
      if (!existingNote) {
        try {
          const reportRes = await apiFetch("/api/sfdc-report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes, vaultPath: settings.vaultPath, meetingTitle }),
          });
          const reportData = await reportRes.json();
          if (reportData.savedPath) setSfdcReportSaved({ path: reportData.savedPath });
        } catch {
          // Weekly report append is best-effort.
        }
      }
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveTranscript(replacements) {
    const { transcript, extendedTranscript, meetingTitle } = meeting;
    if (!transcript.trim() || !settings.vaultPath) return;
    const archiveTranscript = formatTranscriptArchive(transcript, extendedTranscript);
    const withCorrections = applyCorrections(archiveTranscript, settings.corrections || []);
    const corrected = replacements.length
      ? reverseReplacements(applyReplacements(withCorrections, replacements), replacements)
      : withCorrections;

    setSavingTranscript(true);
    try {
      const title = meetingTitle || "Transcript";
      const folderPath = await resolveAutoFolder(`${title} ${corrected}`);
      const res = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: `# ${title}\n\n${corrected}`,
          vaultPath: settings.vaultPath,
          folderPath,
          meetingTitle: title,
          dedupeContent: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setTranscriptSaved(true);
      setTranscriptSavedPath(data.savedPath);

      if (settings.transcriptsPath) {
        apiFetch("/api/save-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: corrected,
            meetingTitle: title,
            transcriptsPath: settings.transcriptsPath,
            folder: folderPath || undefined,
            accounts: settings.accounts || [],
          }),
        }).catch(() => {});
      }
    } catch (e) {
      alert(`Failed to save transcript: ${e.message}`);
    } finally {
      setSavingTranscript(false);
    }
  }

  const clearTranscriptSaved = useCallback(() => {
    setTranscriptSaved(false);
    setTranscriptSavedPath("");
  }, []);

  function reset() {
    clearSaved();
    clearTranscriptSaved();
  }

  return {
    saving,
    saved,
    savedPath,
    todosSaved,
    todoistSaved,
    sfdcReportSaved,
    customerFactsSaved,
    updatedExisting,
    backupPath,
    savingTranscript,
    transcriptSaved,
    transcriptSavedPath,
    saveNote,
    saveTranscript,
    clearSaved,
    clearTranscriptSaved,
    reset,
  };
}
