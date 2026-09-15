"use client";

import { AUTO_MODEL, MODEL_OPTIONS, MODEL_TIERS, PROVIDERS, TIER_MODELS, modelDisplayName, modelRateLabel } from "@/lib/models";

// Both providers get the same three tiers, the same layout, and the same
// amount of space. Nothing here marks one of them as the recommended choice.

function Tile({ selected, onClick, title, sub, price, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2 py-2 text-left transition-colors ${className} ${
        selected ? "bg-obsidian-600 border-obsidian-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
      }`}
    >
      <span className="block text-xs font-semibold">{title}</span>
      <span className={`block text-[10px] ${selected ? "text-obsidian-100" : "text-gray-500"}`}>{sub}</span>
      <span className={`block text-[10px] mt-0.5 ${selected ? "text-obsidian-200" : "text-gray-400"}`}>{price}</span>
    </button>
  );
}

export default function ModelPicker({ model, setModel, compact = false, ariaLabel = "AI model" }) {
  if (compact) {
    return (
      <select aria-label={ariaLabel} value={model} onChange={(event) => setModel(event.target.value)} className="input !w-auto text-xs py-1">
        <option value={AUTO_MODEL}>Auto — task-based routing</option>
        {PROVIDERS.map((provider) => (
          <optgroup key={provider} label={provider === "Claude" ? "Anthropic (Claude)" : "OpenAI (ChatGPT)"}>
            {MODEL_OPTIONS.filter((item) => item.provider === provider).map((item) => (
              <option key={item.id} value={item.id}>{item.label} · {modelRateLabel(item.id)}</option>
            ))}
          </optgroup>
        ))}
      </select>
    );
  }

  const tierModels = PROVIDERS.flatMap((provider) => Object.values(TIER_MODELS[provider]));
  const isPreset = model === AUTO_MODEL || tierModels.includes(model);

  return (
    <div className="w-full space-y-2">
      <Tile
        selected={model === AUTO_MODEL}
        onClick={() => setModel(AUTO_MODEL)}
        title="Auto"
        sub="Routes each task to whichever provider you have configured"
        price="Price varies by routed model"
        className="w-full"
      />

      {PROVIDERS.map((provider) => (
        <div key={provider}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{provider}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {MODEL_TIERS.map((tier) => {
              const id = TIER_MODELS[provider][tier.id];
              return (
                <Tile
                  key={id}
                  selected={model === id}
                  onClick={() => setModel(id)}
                  title={tier.label}
                  sub={modelDisplayName(id)}
                  price={modelRateLabel(id)}
                />
              );
            })}
          </div>
        </div>
      ))}

      <details open={!isPreset}>
        <summary className="cursor-pointer text-xs text-gray-600">Every model</summary>
        <div className="mt-2 grid sm:grid-cols-2 gap-2">
          {PROVIDERS.map((provider) => (
            <div key={provider} className="rounded-lg border border-gray-200 p-2">
              <p className="text-xs font-semibold mb-1">{provider}</p>
              <div className="space-y-1">
                {MODEL_OPTIONS.filter((item) => item.provider === provider).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setModel(item.id)}
                    className={`w-full rounded px-2 py-1.5 text-left ${model === item.id ? "bg-obsidian-600 text-white" : "hover:bg-gray-50 text-gray-700"}`}
                  >
                    <span className="flex justify-between gap-2 text-xs"><strong>{item.label}</strong><span>{item.sub}</span></span>
                    <span className={`block text-[10px] ${model === item.id ? "text-obsidian-100" : "text-gray-400"}`}>{modelRateLabel(item.id)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
