"use client";

import { AUTO_MODEL, MODEL_OPTIONS, modelRateLabel } from "@/lib/models";

const PRESETS = [
  { id: AUTO_MODEL, label: "Auto", sub: "Routes each task", price: "Uses the best configured provider" },
  { id: "gpt-5.6-luna", label: "Fast", sub: "GPT-5.6 Luna", price: modelRateLabel("gpt-5.6-luna") },
  { id: "gpt-5.6-terra", label: "Recommended", sub: "GPT-5.6 Terra", price: modelRateLabel("gpt-5.6-terra") },
  { id: "gpt-6-astra", label: "Highest quality", sub: "GPT-6 Astra", price: modelRateLabel("gpt-6-astra") },
];

export default function ModelPicker({ model, setModel, compact = false, ariaLabel = "AI model" }) {
  if (compact) {
    return (
      <select aria-label={ariaLabel} value={model} onChange={(event) => setModel(event.target.value)} className="input !w-auto text-xs py-1">
        <option value={AUTO_MODEL}>Auto — task-based routing</option>
        <optgroup label="OpenAI (ChatGPT)">{MODEL_OPTIONS.filter((item) => item.provider === "ChatGPT").map((item) => <option key={item.id} value={item.id}>{item.label} · {modelRateLabel(item.id)}</option>)}</optgroup>
        <optgroup label="Anthropic (Claude)">{MODEL_OPTIONS.filter((item) => item.provider === "Claude").map((item) => <option key={item.id} value={item.id}>{item.label} · {modelRateLabel(item.id)}</option>)}</optgroup>
      </select>
    );
  }

  return (
    <div className="w-full space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => setModel(preset.id)} className={`rounded-lg border px-2 py-2 text-left transition-colors ${model === preset.id ? "bg-obsidian-600 border-obsidian-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
          <span className="block text-xs font-semibold">{preset.label}</span>
          <span className={`block text-[10px] ${model === preset.id ? "text-obsidian-100" : "text-gray-500"}`}>{preset.sub}</span>
          <span className={`block text-[10px] mt-0.5 ${model === preset.id ? "text-obsidian-200" : "text-gray-400"}`}>{preset.price}</span>
        </button>)}
      </div>
      <details open={!PRESETS.some((preset) => preset.id === model)}>
        <summary className="cursor-pointer text-xs text-gray-600">Advanced model list</summary>
        <div className="mt-2 grid sm:grid-cols-2 gap-2">
          {["ChatGPT", "Claude"].map((provider) => <div key={provider} className="rounded-lg border border-gray-200 p-2">
            <p className="text-xs font-semibold mb-1">{provider}</p>
            <div className="space-y-1">{MODEL_OPTIONS.filter((item) => item.provider === provider).map((item) => <button key={item.id} type="button" onClick={() => setModel(item.id)} className={`w-full rounded px-2 py-1.5 text-left ${model === item.id ? "bg-obsidian-600 text-white" : "hover:bg-gray-50 text-gray-700"}`}>
              <span className="flex justify-between gap-2 text-xs"><strong>{item.label}</strong><span>{item.sub}</span></span>
              <span className={`block text-[10px] ${model === item.id ? "text-obsidian-100" : "text-gray-400"}`}>{modelRateLabel(item.id)}</span>
            </button>)}</div>
          </div>)}
        </div>
      </details>
    </div>
  );
}
