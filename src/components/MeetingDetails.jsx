"use client";

export default function MeetingDetails({ meetingTitle, setMeetingTitle, meetingContext, setMeetingContext }) {
  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-5">
        <StepBadge n={1} />
        <div>
          <h2 className="text-base font-semibold text-gray-900">Meeting Details</h2>
          <p className="text-xs text-gray-500">Give your notes a title (include the date in the title)</p>
        </div>
      </div>

      <div>
        <label className="label">Meeting Title</label>
        <input
          type="text"
          className="input"
          placeholder="e.g. 2026-06-05 - Lockheed Kickoff"
          value={meetingTitle}
          onChange={(e) => setMeetingTitle(e.target.value)}
          autoFocus
        />
        {meetingTitle && (
          <p className="mt-2 text-xs text-gray-400">
            Generated notes will be saved as{" "}
            <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
              {meetingTitle}.md
            </span>
          </p>
        )}
      </div>

      <div className="mt-4">
        <label className="label">Additional Context &amp; Your Notes <span className="font-normal text-gray-400">(optional — never saved as a file)</span></label>
        <p className="text-xs text-gray-500 mb-2">
          Anything the transcript won't say on its own — who attended and their roles, what the meeting was
          about, account background, follow-ups from a prior call, or your own handwritten notes from the
          meeting. Woven into the generated notes and SFDC entry, then discarded — this text is not saved
          anywhere on its own.
        </p>
        <textarea
          className="input resize-y text-xs leading-relaxed"
          rows={4}
          placeholder={"e.g. Quarterly sync with Gokul (LM MFC EA admin) and Jordan. Follow-up to the June SystemLink migration briefing.\nMy notes: Gokul wants SL Pro rollout confirmed before August; sounded frustrated about Data Bridge re-ingestion."}
          value={meetingContext}
          onChange={(e) => setMeetingContext(e.target.value)}
        />
      </div>
    </div>
  );
}

export function StepBadge({ n }) {
  return (
    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-obsidian-600 text-white text-sm font-bold flex items-center justify-center">
      {n}
    </span>
  );
}
