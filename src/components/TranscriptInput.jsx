"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { StepBadge } from "@/components/MeetingDetails";
import { apiFetch } from "@/lib/apiClient";

export default function TranscriptInput({ transcript, setTranscript, onTitleSuggest }) {
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState("paste");
  const [waiting, setWaiting] = useState(false);
  const [received, setReceived] = useState(false);
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!file.type.startsWith("text/") && !file.name.endsWith(".txt") && !file.name.endsWith(".md")) {
      alert("Please upload a plain text file (.txt or .md)");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setTranscript(e.target.result);
      if (onTitleSuggest) {
        const name = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        onTitleSuggest(name);
      }
    };
    reader.readAsText(file);
  }, [setTranscript, onTitleSuggest]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);

  function startWaiting() {
    setWaiting(true);
    setReceived(false);
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch("/api/receive-transcript");
        const data = await res.json();
        if (data.pending) {
          stopWaiting();
          setTranscript(data.transcript);
          if (data.title && onTitleSuggest) onTitleSuggest(data.title);
          setReceived(true);
          setActiveTab("paste");
        }
      } catch {}
    }, 1500);
  }

  function stopWaiting() {
    setWaiting(false);
    clearInterval(pollRef.current);
    pollRef.current = null;
  }

  // Clean up on unmount
  useEffect(() => () => clearInterval(pollRef.current), []);

  function handleTabChange(tab) {
    if (activeTab === "voice" && waiting) stopWaiting();
    setActiveTab(tab);
  }

  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-5">
        <StepBadge n={2} />
        <div>
          <h2 className="text-base font-semibold text-gray-900">Meeting Transcript</h2>
          <p className="text-xs text-gray-500">Paste, upload, or import from Voice Memos</p>
        </div>
      </div>

      <div className="flex gap-1 mb-3">
        {[
          { id: "paste", label: "Paste Text" },
          { id: "upload", label: "Upload File" },
          { id: "voice", label: "Voice Memo" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-obsidian-600 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "paste" && (
        <textarea
          className="input resize-none font-mono text-xs leading-relaxed"
          rows={14}
          placeholder="Paste your meeting transcript here..."
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
        />
      )}

      {activeTab === "upload" && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-12 cursor-pointer transition-colors ${
            isDragging
              ? "border-obsidian-400 bg-obsidian-50"
              : "border-gray-300 hover:border-obsidian-400 hover:bg-gray-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files[0])}
          />
          <svg className="w-10 h-10 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {transcript ? (
            <div className="text-center">
              <p className="text-sm font-medium text-green-600">File loaded!</p>
              <p className="text-xs text-gray-500 mt-1">{wordCount.toLocaleString()} words</p>
              <p className="text-xs text-gray-400 mt-1">Click to replace</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">Drop your transcript here</p>
              <p className="text-xs text-gray-500 mt-1">or click to browse — .txt or .md files</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "voice" && (
        <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-12 gap-4">
          {received ? (
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-green-600 mb-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-base font-medium">Transcript received!</span>
              </div>
              <p className="text-xs text-gray-500">{wordCount.toLocaleString()} words loaded — switch to Paste Text to review</p>
            </div>
          ) : waiting ? (
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-obsidian-600 mb-3">
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm font-medium">Waiting for Voice Memo...</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">Run your Shortcut in Voice Memos to send the transcript here</p>
              <button onClick={stopWaiting} className="btn-secondary text-xs">Cancel</button>
            </div>
          ) : (
            <div className="text-center">
              <svg className="w-10 h-10 text-gray-400 mb-3 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <p className="text-sm font-medium text-gray-700 mb-1">Import from Voice Memos</p>
              <p className="text-xs text-gray-500 mb-4">Click below, then run your Shortcut in Voice Memos</p>
              <button onClick={startWaiting} className="btn-primary">
                Wait for Voice Memo
              </button>
            </div>
          )}
        </div>
      )}

      {transcript && activeTab !== "voice" && (
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-gray-500">{wordCount.toLocaleString()} words</p>
          <button onClick={() => setTranscript("")} className="text-xs text-red-500 hover:text-red-700">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
