export const DEFAULT_NOTE_TEMPLATE_ID = "csm-default";
export const DEFAULT_RECIPE_ID = "none";

export const NOTE_TEMPLATES = [
  {
    id: "csm-default",
    name: "CSM meeting note",
    description: "Default NI customer-success note with CS takeaways, callouts, action items, and SFDC entry.",
    prompt: "Use the standard NI CSM meeting-note structure. Keep the note operational, customer-success focused, and ready to save in Obsidian.",
  },
  {
    id: "customer-sync",
    name: "Customer sync",
    description: "Emphasizes customer asks, blockers, owners, relationship dynamics, and follow-up commitments.",
    prompt: "Prioritize customer asks, decision makers, blockers, adoption signals, and follow-up commitments. Make it easy to prepare for the next customer touchpoint.",
  },
  {
    id: "technical-deep-dive",
    name: "Technical deep dive",
    description: "Pulls out architecture details, product versions, integrations, constraints, risks, and unresolved questions.",
    prompt: "Prioritize technical substance: tools, versions, architectures, data flows, product constraints, implementation blockers, open technical questions, and risks that need engineering or support follow-up.",
  },
  {
    id: "internal-debrief",
    name: "Internal debrief",
    description: "Optimized for account-team alignment and handoff after an internal or customer-facing meeting.",
    prompt: "Prioritize internal alignment: account strategy, who needs to know what, risks, opportunities, owner-specific actions, and what the account team should do next.",
  },
  {
    id: "executive-brief",
    name: "Executive brief",
    description: "Sharper summary for leaders, with outcomes, risks, asks, and customer value signals up front.",
    prompt: "Make the note executive-readable. Lead with outcomes, customer value, renewal or expansion impact, material risks, and explicit asks. Keep detail useful but terse.",
  },
];

export const NOTE_RECIPES = [
  {
    id: "none",
    name: "No recipe",
    description: "Generate the selected note template without an extra analysis lens.",
    prompt: "",
  },
  {
    id: "renewal-risk",
    name: "Renewal risk scan",
    description: "Calls out renewal threats, dissatisfaction, support gaps, and missing value proof.",
    prompt: "Add a renewal-risk lens. Explicitly flag dissatisfaction, unresolved blockers, weak adoption, competitive pressure, missing executive sponsorship, unclear value proof, and any CSM actions that reduce renewal risk.",
  },
  {
    id: "adoption-blockers",
    name: "Adoption blockers",
    description: "Focuses on technical, process, enablement, and stakeholder blockers to software usage.",
    prompt: "Add an adoption-blocker lens. Identify technical blockers, process blockers, enablement gaps, stakeholder resistance, missing owners, timeline risks, and what would unblock usage of NI software.",
  },
  {
    id: "stakeholder-plan",
    name: "Stakeholder plan",
    description: "Turns people mentions into champions, blockers, sponsors, admins, and next-touch guidance.",
    prompt: "Add a stakeholder-planning lens. Identify champions, blockers, admins, technical evaluators, sponsors, missing stakeholders, relationship signals, and who should be engaged next.",
  },
  {
    id: "sfdc-polish",
    name: "SFDC polish",
    description: "Tightens the Salesforce activity entry and makes CRM-safe follow-up more prominent.",
    prompt: "Add an SFDC-polish lens. Be especially careful that the SFDC Activity Entry is concise, CRM-safe, outcome-led, and only includes CSM-owned next steps supported by the sources.",
  },
  {
    id: "next-meeting-prep",
    name: "Next meeting prep",
    description: "Pulls out prep bullets for the next customer interaction.",
    prompt: "Add a next-meeting-prep lens. Capture what to remember before the next call, questions to ask, sensitive topics, wins to reference, and concrete preparation actions.",
  },
];

export function resolveNoteTemplate(id) {
  return NOTE_TEMPLATES.find((template) => template.id === id) || NOTE_TEMPLATES[0];
}

export function resolveNoteRecipe(id) {
  return NOTE_RECIPES.find((recipe) => recipe.id === id) || NOTE_RECIPES[0];
}

export function buildWorkflowInstruction({
  noteTemplateId = DEFAULT_NOTE_TEMPLATE_ID,
  recipeId = DEFAULT_RECIPE_ID,
  customTemplateInstructions = "",
  customRecipeInstructions = "",
} = {}) {
  const template = resolveNoteTemplate(noteTemplateId);
  const recipe = resolveNoteRecipe(recipeId);
  const customTemplate = customTemplateInstructions.trim();
  const customRecipe = customRecipeInstructions.trim();

  const parts = [
    `Selected note template: ${template.name}`,
    template.prompt,
  ];

  if (customTemplate) {
    parts.push(`Template override from the CSM: ${customTemplate}`);
  }

  if (recipe.id !== DEFAULT_RECIPE_ID && recipe.prompt) {
    parts.push(`Selected recipe: ${recipe.name}`, recipe.prompt);
  }

  if (customRecipe) {
    parts.push(`Additional recipe instruction from the CSM: ${customRecipe}`);
  }

  return parts.join("\n");
}
