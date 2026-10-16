import {
  extractDeterministicSensitiveEntities,
  extractKnownSensitiveEntities,
  mergeSensitiveEntities,
} from "./privacy";
import { createHash } from "node:crypto";

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" || block?.type === "input_text")
    .map((block) => block.text || "")
    .join("\n");
}

export function outboundPromptText(params = {}) {
  return [
    typeof params.system === "string" ? params.system : "",
    ...(params.messages || []).map((message) => contentText(message?.content)),
  ].filter(Boolean).join("\n");
}

export function outboundHasImages(params = {}) {
  return (params.messages || []).some((message) => Array.isArray(message?.content)
    && message.content.some((block) => block?.type === "image" || block?.type === "input_image"));
}

export function privacyAuditRecord(decision, params = {}, findings = [], reason = "") {
  const prompt = outboundPromptText(params);
  const counts = findings.reduce((all, item) => ({ ...all, [item.type]: (all[item.type] || 0) + 1 }), {});
  return {
    event: "outbound-privacy",
    decision,
    reason,
    at: new Date().toISOString(),
    requestHash: createHash("sha256").update(prompt).digest("hex").slice(0, 16),
    textChars: prompt.length,
    imageCount: (params.messages || []).reduce((count, message) => count + (Array.isArray(message?.content)
      ? message.content.filter((block) => block?.type === "image" || block?.type === "input_image").length
      : 0), 0),
    findings: counts,
  };
}

function auditBlocked(params, findings, reason) {
  // Never log prompt text or matched values. The short hash lets a local
  // operator correlate repeated blocks without storing source content.
  console.warn(`[privacy-boundary] ${JSON.stringify(privacyAuditRecord("blocked", params, findings, reason))}`);
}

function templateLineSet(templateText) {
  return new Set(
    String(templateText || "").split("\n").map((line) => line.trim()).filter(Boolean)
  );
}

// The fixed instruction text of a prompt (its section format, rules, and
// worked examples) is ours, not the user's, so it is not scanned: an example
// name that happens to match a term in the user's glossary would otherwise
// block every request. Only a line that is character-for-character a template
// line is skipped. Any line carrying user content differs from the template,
// so it is still scanned in full.
function withoutTemplateLines(text, templateText) {
  const template = templateLineSet(templateText);
  if (!template.size) return text;
  return text.split("\n").filter((line) => !template.has(line.trim())).join("\n");
}

export function inspectOutboundPrivacy(params = {}, policy = {}) {
  if (policy?.enabled === false) return [];
  const text = withoutTemplateLines(outboundPromptText(params), policy?.templateText);
  const configured = (policy?.sensitiveTerms || []).map((term) => (
    typeof term === "string" ? { text: term, type: "org" } : term
  ));
  return mergeSensitiveEntities(
    extractDeterministicSensitiveEntities(text),
    extractKnownSensitiveEntities(text, configured)
  );
}

export function assertOutboundPrivacy(params = {}, policy = {}) {
  if (policy?.enabled === false) return;
  if (outboundHasImages(params) && policy?.allowImages !== true) {
    auditBlocked(params, [], "image-confirmation-required");
    throw Object.assign(new Error("Privacy boundary blocked an image request. Confirm that the image was reviewed and may be sent to the selected AI."), {
      status: 422,
      code: "PRIVACY_IMAGE_CONFIRMATION_REQUIRED",
    });
  }
  const findings = inspectOutboundPrivacy(params, policy);
  if (!findings.length) return;
  auditBlocked(params, findings, "unresolved-sensitive-data");
  const counts = Object.entries(findings.reduce((all, item) => ({ ...all, [item.type]: (all[item.type] || 0) + 1 }), {}))
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
  throw Object.assign(new Error(`Privacy boundary blocked this AI request: unresolved sensitive data (${counts}). Return to Privacy Review and anonymize it before retrying.`), {
    status: 422,
    code: "PRIVACY_BOUNDARY_BLOCKED",
    findings: findings.map(({ type }) => ({ type })),
  });
}

export function privacyPolicyFromReplacements(replacements = [], extra = {}) {
  return {
    ...extra,
    sensitiveTerms: [
      ...(extra.sensitiveTerms || []),
      ...(replacements || []).flatMap((item) => [item?.original, item?.restored]).filter(Boolean),
    ],
  };
}
