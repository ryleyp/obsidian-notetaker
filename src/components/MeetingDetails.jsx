"use client";

export default function MeetingDetails({ meetingTitle, setMeetingTitle }) {
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
      </div>

      {meetingTitle && (
        <p className="mt-3 text-xs text-gray-400">
          File will be saved as{" "}
          <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
            {meetingTitle}.md
          </span>
        </p>
      )}
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
