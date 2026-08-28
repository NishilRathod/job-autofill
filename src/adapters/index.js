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
      for (const [pattern, path] of Object.entries(adapter.selectors ?? {})) {
        const test = new RegExp(pattern, "i");
        for (const descriptor of descriptors) {
          // Vendor-stable attributes first: Workday's data-automation-id and
          // Greenhouse's field names outlive their visible labels.
          const haystack = `${descriptor.name} ${descriptor.id} ${descriptor.automationId ?? ""}`;
          if (test.test(haystack) && !hints[descriptor.fieldId]) {
            hints[descriptor.fieldId] = path;
          }
        }
      }
      return hints;
    },
  };
}

/** Every registered adapter's name, for the options page and docs. */
export const adapterNames = () => ADAPTERS.map((a) => a.name);
