"use client";

import { NOTE_RECIPES, NOTE_TEMPLATES } from "@/lib/noteWorkflows";
import { StepBadge } from "@/components/MeetingDetails";

export default function NoteWorkflowPanel({
  noteTemplateId,
  setNoteTemplateId,
  recipeId,
  setRecipeId,
  customTemplateInstructions,
  setCustomTemplateInstructions,
  customRecipeInstructions,
  setCustomRecipeInstructions,
}) {
  const selectedTemplate = NOTE_TEMPLATES.find((template) => template.id === noteTemplateId) || NOTE_TEMPLATES[0];
  const selectedRecipe = NOTE_RECIPES.find((recipe) => recipe.id === recipeId) || NOTE_RECIPES[0];

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-5">
        <StepBadge n={3} />
        <div>
          <h2 className="text-base font-semibold text-gray-900">Template &amp; Recipe</h2>
          <p className="text-xs text-gray-500">Choose the note shape and the extra analysis lens</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Note Template</label>
          <select
            className="input"
            value={noteTemplateId}
            onChange={(event) => setNoteTemplateId(event.target.value)}
          >
            {NOTE_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-gray-500">{selectedTemplate.description}</p>
        </div>

        <div>
          <label className="label">Recipe</label>
          <select
            className="input"
            value={recipeId}
            onChange={(event) => setRecipeId(event.target.value)}
          >
            {NOTE_RECIPES.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>{recipe.name}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-gray-500">{selectedRecipe.description}</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <div>
          <label className="label">Template Override</label>
          <textarea
            className="input resize-y text-xs leading-relaxed"
            rows={3}
            placeholder="e.g. Add a brief Technical Risks section before Action Items."
            value={customTemplateInstructions}
            onChange={(event) => setCustomTemplateInstructions(event.target.value)}
          />
        </div>
        <div>
          <label className="label">Recipe Instruction</label>
          <textarea
            className="input resize-y text-xs leading-relaxed"
            rows={3}
            placeholder="e.g. Focus the risk scan on SystemLink rollout blockers."
            value={customRecipeInstructions}
            onChange={(event) => setCustomRecipeInstructions(event.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
