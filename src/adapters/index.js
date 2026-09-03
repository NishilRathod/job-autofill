/**
 * Per-site adapters.
 *
 * An adapter is mostly data: a URL pattern, a map of selectors to canonical
 * field paths for the fields the generic engine gets wrong, and flags for
 * widget quirks. Keeping them declarative means they are unit-testable, and
 * that adding support for a job board usually needs no DOM code at all — which
 * matters, because ATS vendors redesign often and the maintenance burden has to
 * stay low.
 *
 * See docs/ARCHITECTURE.md, and CONTRIBUTING.md for how to add one.
 */

import { ATS_ADAPTERS } from "./ats.js";
import { RULE_BY_PATH } from "../core/rules.js";
import { descriptorTokens, tokenCoverage } from "../core/normalize.js";

/**
 * Whether a field is disqualified from a path by that path's own vetoes.
 *
 * Adapter hints deliberately outrank the heuristics, vetoes included: a
 * `selectors` entry names one exact attribute on one known site and is
 * hand-verified. A `questions` entry is not that. It matches prose, and prose
 * on an application form is full of near-misses — "Phone (Emergency Contact)"
 * begins with "Phone" as surely as the applicant's own field does. So question
 * matches keep the safety net that attribute matches can do without.
 */
function vetoed(path, descriptor) {
  const rule = RULE_BY_PATH.get(path);
  if (!rule?.veto.length) return false;

  const { all } = descriptorTokens(descriptor);
  return rule.veto.some((vetoTokens) => tokenCoverage(vetoTokens, all) === 1);
}

/**
 * Every adapter, most specific first.
 *
 * Imported as data rather than registered by side effect: a module calling
 * back into this one would be an import cycle, and the array would be in its
 * temporal dead zone when the registration ran.
 */
const ADAPTERS = ATS_ADAPTERS;

/**
 * The adapter for a URL, or null when the generic engine is on its own.
 *
 * Returns an object exposing `hintsFor`, which maps the descriptors of a
 * scanned page to canonical paths. Hints are applied by the matcher at a score
 * just below a learned mapping: hand-verified for the site, but still yielding
 * to a correction the user made themselves.
 */
export function adapterFor(url) {
  const adapter = ADAPTERS.find((candidate) => candidate.match.test(url ?? ""));
  if (!adapter) return null;

  return {
    name: adapter.name,

    /**
     * Map fieldIds to canonical paths for this page.
     *
     * Matching is done against the descriptors the collector already produced
     * rather than by querying the DOM, so adapters stay free of DOM code and
     * can be tested with plain objects.
     *
     * @param {object[]} descriptors
     * @returns {Record<string, string>} fieldId -> canonical path
     */
    hintsFor(descriptors) {
      const hints = {};

      // Attributes first. Vendor-stable naming outlives the visible label,
      // which is localised and re-worded between tenants.
      //
      // Ancestor ids are included because the specific name is frequently on a
      // wrapper rather than on the control: Workday puts a generic id on the
      // input and `formField-<section>--<field>` on the div around it, so an
      // adapter reading only the field's own attributes matches nothing on a
      // real page while still passing a simplified fixture.
      for (const [pattern, path] of Object.entries(adapter.selectors ?? {})) {
        const test = new RegExp(pattern, "i");
        for (const descriptor of descriptors) {
          const haystack = [
            descriptor.name,
            descriptor.id,
            descriptor.automationId ?? "",
            ...(descriptor.ancestorIds ?? []),
          ].join(" ");
          if (test.test(haystack) && !hints[descriptor.fieldId]) {
            hints[descriptor.fieldId] = path;
          }
        }
      }

      // Then the visible question, for sites whose attributes carry no meaning
      // at all. Lever names custom questions `cards[<uuid>][field7]` and Zoho
      // Recruit names every field `rec-form_<digits>`; on those the rendered
      // label is the only thing that identifies a field, and matching it
      // per-site is safer than loosening the global rules for everyone.
      for (const [pattern, path] of Object.entries(adapter.questions ?? {})) {
        const test = new RegExp(pattern, "i");
        for (const descriptor of descriptors) {
          if (hints[descriptor.fieldId]) continue;
          if (!test.test(descriptor.label ?? "")) continue;
          // Unlike a selector, a question match is a guess about prose, so it
          // has to clear the same vetoes a heuristic match would.
          if (vetoed(path, descriptor)) continue;
          hints[descriptor.fieldId] = path;
        }
      }

      return hints;
    },
  };
}

/** Every registered adapter's name, for the options page and docs. */
export const adapterNames = () => ADAPTERS.map((a) => a.name);
