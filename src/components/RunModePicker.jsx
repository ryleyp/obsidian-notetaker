"use client";

import ModelPicker from "@/components/ModelPicker";
import { modelDisplayName } from "@/lib/models";
import { runMode, RUN_MODES } from "@/lib/runModes";

export default function RunModePicker({
  value, onChange, estimatedCost, alternateEstimatedCost, model,
  reviewModel, onReviewModelChange, allowFlagged = false, disabled = false,
}) {
  const modes = allowFlagged ? RUN_MODES : RUN_MODES.filter((mode) => mode.id !== "flagged");
  const selected = runMode(value);
  const otherCost = alternateEstimatedCost ?? estimatedCost;
  const reviewCost = selected.id === "flagged" ? otherCost * 0.25 : otherCost;
  const total = estimatedCost == null ? null : selected.id === "quick" ? estimatedCost : estimatedCost + reviewCost;
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-gray-600">Run mode</legend>
      <div className="grid sm:grid-cols-2 gap-2">
        {modes.map((mode) => (
          <label key={mode.id} className={`rounded-lg border p-2 text-xs cursor-pointer ${value === mode.id ? "border-obsidian-500 bg-obsidian-50" : "border-gray-200 bg-white"}`}>
            <span className="flex gap-2 items-start">
              <input type="radio" name="run-mode" value={mode.id} checked={value === mode.id} onChange={() => onChange(mode.id)} disabled={disabled} className="mt-0.5" />
              <span><strong className="block text-gray-800">{mode.label}</strong><span className="text-gray-500">{mode.description}</span></span>
            </span>
          </label>
        ))}
      </div>
      {selected.id !== "quick" && onReviewModelChange && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-600 whitespace-nowrap">Review with:</span>
          <ModelPicker model={reviewModel} setModel={onReviewModelChange} compact ariaLabel="Review model" />
        </div>
      )}
      {total != null && <p className="text-xs text-gray-500">
        Estimated {selected.label.toLowerCase()}: <strong>{modelDisplayName(model)}</strong> ~${estimatedCost.toFixed(4)}
        {selected.id !== "quick" && <> + <strong>{modelDisplayName(reviewModel)}</strong> ~${reviewCost.toFixed(4)}</>}
        {selected.id !== "quick" && <> = <strong>~${total.toFixed(4)} total</strong></>}. Actual usage varies.
      </p>}
    </fieldset>
  );
}
