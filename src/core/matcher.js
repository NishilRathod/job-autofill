/**
 * The scoring engine: given a page's fields and a profile, decide what to fill.
 *
 * Input is an array of FieldDescriptor — plain JSON produced by the content
 * script, with no element references. Output is a FillPlan, also plain JSON.
 * That boundary is what lets this file be tested exhaustively against saved
 * form HTML without a browser, and it is where all the real complexity lives.
 *
 * No DOM, no chrome.* APIs. See docs/ARCHITECTURE.md.
 */

import { RULES } from "./rules.js";
import { tokenize, tokenCoverage, signatureOf } from "./normalize.js";
import { NEVER_AUTOFILL, getField } from "./schema.js";
import { resolveValue } from "./derive.js";

/**
 * How much each signal is worth.
 *
 * The ordering matters more than the exact numbers. An `autocomplete` token is
 * a machine-readable declaration by the form's own author, so it beats every
 * heuristic. A learned mapping is the user's explicit correction, so it beats
 * everything except the author's own declaration. Below that, a matching label
 * is far better evidence than a matching `name` attribute, which is in turn
 * better than a placeholder.
 */
export const SCORES = {
  autocomplete: 100,
  learned: 95,
  adapter: 90,
  labelExact: 78,
  /**
   * Ceiling for a partial label match, scaled down by how much of the label the
   * rule accounts for (see SPECIFICITY_FLOOR).
   *
   * Real form labels are verbose — "Are you legally authorized to work in the
   * United States?" — so partial matching is the common case, not the fallback.
   * It has to sit comfortably above nameToken when the match is meaningful.
   */
  labelPartial: 70,
  nameToken: 55,
  placeholder: 45,
  contextBonus: 10,
};

/**
 * How far a partial label match is discounted when the rule explains only a
 * little of the label.
 *
 * A rule of "linked" against "LinkedIn Profile" covers half the label and
 * should fill. A rule of "name" against "What name would you like on your
 * badge?" covers a sixth and should not. With the floor at 0.72, a match needs
 * to explain roughly a quarter of the label to clear the default threshold.
 */
const SPECIFICITY_FLOOR = 0.72;

/** @typedef {object} FieldDescriptor
 * @property {string} fieldId      Opaque id the content script can resolve back to an element.
 * @property {string} [tag]        "input" | "select" | "textarea" | custom
 * @property {string} [type]       Input type, or a synthetic one like "combobox".
 * @property {string} [name]
 * @property {string} [id]
 * @property {string} [autocomplete]
 * @property {string} [label]      Resolved visible label.
 * @property {string} [placeholder]
 * @property {string} [ariaLabel]
 * @property {string} [sectionText] Nearest heading or legend, for context.
 * @property {number} [sectionIndex] Which repeat of that section this is.
 * @property {string[]} [options]  Option labels, for selects and radio groups.
 * @property {boolean} [hasValue]  Whether the field is already filled in.
 * @property {boolean} [disabled]
 */

/** Text that should never be auto-answered, whatever it scores. */
function isForbiddenQuestion(haystack) {
  return NEVER_AUTOFILL.some((phrase) => haystack.includes(phrase));
}

/**
 * Score one rule against one descriptor.
 * @returns {{score: number, reason: string} | null}
 */
function scoreRule(rule, descriptor, tokensByPart) {
  const { labelTokens, nameTokens, placeholderTokens, contextTokens, allTokens } = tokensByPart;

  // --- Vetoes first. A veto is absolute: a field that says "emergency contact
  // first name" must not receive a first name no matter how well it otherwise
  // scores. Checked against every text part, since the disqualifying word may
  // appear in a heading rather than the label.
  for (const vetoTokens of rule.veto) {
    if (tokenCoverage(vetoTokens, allTokens) === 1) return null;
  }

  // --- The form author told us outright.
  if (rule.autocomplete && descriptor.autocomplete) {
    const declared = String(descriptor.autocomplete).toLowerCase().trim();
    // Tokens may be prefixed with a section or scope, e.g. "shipping given-name".
    if (declared.split(/\s+/).includes(rule.autocomplete)) {
      return { score: SCORES.autocomplete, reason: `autocomplete="${rule.autocomplete}"` };
    }
  }

  let best = null;
  const consider = (score, reason) => {
    if (!best || score > best.score) best = { score, reason };
  };

  for (const phraseTokens of rule.phraseTokens) {
    // Exact label match: the label reduces to precisely this phrase.
    if (labelTokens.length && phraseTokens.join(" ") === labelTokens.join(" ")) {
      consider(SCORES.labelExact, `label matches "${phraseTokens.join(" ")}"`);
      continue;
    }

    // Partial label match: every word of the rule appears in the label, which
    // is the normal case for real labels like "Applicant legal first name".
    if (labelTokens.length && tokenCoverage(phraseTokens, labelTokens) === 1) {
      // Scaled by how much of the label the phrase accounts for, so a two-word
      // rule matching a two-word label beats it matching a ten-word question.
      const specificity = phraseTokens.length / labelTokens.length;
      const scale = SPECIFICITY_FLOOR + (1 - SPECIFICITY_FLOOR) * specificity;
      consider(SCORES.labelPartial * scale, `label contains "${phraseTokens.join(" ")}"`);
      continue;
    }

    if (nameTokens.length && tokenCoverage(phraseTokens, nameTokens) === 1) {
      consider(SCORES.nameToken, `name/id contains "${phraseTokens.join(" ")}"`);
      continue;
    }

    if (placeholderTokens.length && tokenCoverage(phraseTokens, placeholderTokens) === 1) {
      consider(SCORES.placeholder, `placeholder contains "${phraseTokens.join(" ")}"`);
    }
  }

  if (!best) return null;

  // --- Context bonus. A "School" heading above a field makes education fields
  // more plausible and is often the only thing separating an employment block
  // from an education block that share field names like "Start date".
  if (rule.context.length && contextTokens.length) {
    if (rule.context.some((c) => tokenCoverage(c, contextTokens) === 1)) {
      best = { score: best.score + SCORES.contextBonus, reason: `${best.reason}, in a matching section` };
    }
  }

  // Priority nudges ties without letting a preference override real evidence.
  return { score: best.score + (rule.priority - 1), reason: best.reason };
}

/**
 * Pre-tokenise every text part of a descriptor once.
 * Called once per field; each rule then reuses the result.
 */
function tokensFor(descriptor) {
  const labelTokens = tokenize(descriptor.label ?? descriptor.ariaLabel ?? "");
  const nameTokens = tokenize(`${descriptor.name ?? ""} ${descriptor.id ?? ""}`);
  const placeholderTokens = tokenize(descriptor.placeholder ?? "");
  const contextTokens = tokenize(descriptor.sectionText ?? "");
  return {
    labelTokens,
    nameTokens,
    placeholderTokens,
    contextTokens,
    allTokens: [...labelTokens, ...nameTokens, ...placeholderTokens, ...contextTokens],
  };
}

/**
 * Turn a canonical path into the concrete one for this descriptor.
 *
 * A repeating field's rule is written once ("work.company") but the page may
 * show three employment blocks. The descriptor's sectionIndex says which one.
 */
function concretePath(rule, descriptor) {
  const field = getField(rule.path);
  if (!field?.repeating) return rule.path;
  const index = Number.isInteger(descriptor.sectionIndex) ? descriptor.sectionIndex : 0;
  return `${rule.sectionId}.${index}.${rule.path.split(".")[1]}`;
}

/**
 * Match a page's fields against a profile.
 *
 * @param {object} options
 * @param {FieldDescriptor[]} options.descriptors
 * @param {object} options.profile
 * @param {object} options.settings
 * @param {Record<string,string>} [options.learned]  signature -> canonical path
 * @param {Record<string,string>} [options.adapterHints] fieldId -> canonical path
 * @returns {{
 *   fills: Array<{fieldId: string, path: string, value: *, score: number, reason: string, label: string}>,
 *   skipped: Array<{fieldId: string, label: string, reason: string}>,
 *   unmatched: Array<{fieldId: string, label: string, signature: string}>
 * }}
 */
export function match({ descriptors, profile, settings, learned = {}, adapterHints = {} }) {
  const threshold = settings?.confidenceThreshold ?? 55;
  const candidates = [];
  const skipped = [];
  const unmatched = [];

  for (const descriptor of descriptors) {
    if (descriptor.disabled) continue;

    const label = descriptor.label || descriptor.ariaLabel || descriptor.placeholder || descriptor.name || "(unlabelled)";
    const tokensByPart = tokensFor(descriptor);
    const haystack = tokensByPart.allTokens.join(" ");
    const signature = signatureOf(descriptor);

    // Questions we refuse to answer, before any scoring.
    if (isForbiddenQuestion(haystack)) {
      skipped.push({ fieldId: descriptor.fieldId, label, reason: "Left for you — this question's correct answer depends on where you live" });
      continue;
    }

    // Already filled, and the user has not asked to overwrite.
    if (descriptor.hasValue && !settings?.overwriteExisting) {
      skipped.push({ fieldId: descriptor.fieldId, label, reason: "Already has a value" });
      continue;
    }

    // --- Highest-authority sources, in order.
    const forced = adapterHints[descriptor.fieldId] ?? learned[signature];
    if (forced) {
      candidates.push({
        fieldId: descriptor.fieldId,
        path: forced,
        score: adapterHints[descriptor.fieldId] ? SCORES.adapter : SCORES.learned,
        reason: adapterHints[descriptor.fieldId] ? "matched by site adapter" : "you taught JobFill this field",
        label,
        signature,
      });
      continue;
    }

    // --- Heuristic scoring across every rule.
    let best = null;
    for (const rule of RULES) {
      const scored = scoreRule(rule, descriptor, tokensByPart);
      if (scored && (!best || scored.score > best.score)) {
        best = { ...scored, rule };
      }
    }

    if (!best || best.score < threshold) {
      unmatched.push({ fieldId: descriptor.fieldId, label, signature });
      continue;
    }

    candidates.push({
      fieldId: descriptor.fieldId,
      path: concretePath(best.rule, descriptor),
      score: Math.round(best.score),
      reason: best.reason,
      label,
      signature,
      rule: best.rule,
    });
  }

  // --- Resolve conflicts: one path may only be claimed once, by its best
  // candidate. Without this, three inputs whose labels all contain "name" would
  // each receive the same value.
  const claimed = new Map();
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const existing = claimed.get(candidate.path);
    if (existing) {
      unmatched.push({ fieldId: candidate.fieldId, label: candidate.label, signature: candidate.signature });
      continue;
    }
    claimed.set(candidate.path, candidate);
  }

  // --- Turn winning candidates into concrete values.
  const fills = [];
  for (const candidate of claimed.values()) {
    const field = getField(candidate.path);

    // The demographics gate. Checked here rather than earlier so the popup can
    // still report these as deliberately skipped rather than silently missing.
    if (field?.sensitive && !settings?.fillDemographics) {
      skipped.push({
        fieldId: candidate.fieldId,
        label: candidate.label,
        reason: "Self-identification filling is turned off",
      });
      continue;
    }

    const value = resolveValue(candidate.path, profile);
    if (value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length)) {
      skipped.push({ fieldId: candidate.fieldId, label: candidate.label, reason: "Nothing saved for this field yet" });
      continue;
    }

    fills.push({
      fieldId: candidate.fieldId,
      path: candidate.path,
      value,
      score: candidate.score,
      reason: candidate.reason,
      label: candidate.label,
    });
  }

  // Present in page order rather than score order: the preview reads as a
  // walk down the form, which is how the user will check it.
  const order = new Map(descriptors.map((d, index) => [d.fieldId, index]));
  const byPageOrder = (a, b) => (order.get(a.fieldId) ?? 0) - (order.get(b.fieldId) ?? 0);

  return {
    fills: fills.sort(byPageOrder),
    skipped: skipped.sort(byPageOrder),
    unmatched: unmatched.sort(byPageOrder),
  };
}
