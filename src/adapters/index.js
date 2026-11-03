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
 * Compile an adapter pattern, reading `\b` as a *separator* boundary.
 *
 * `\b` cannot be used literally against form field names, and the failure is
 * silent. An underscore is a word character, so `\bcity\b` matches
 * "address--city" and "address.city" but not "address_city" — and snake_case is
 * the most common naming convention there is. Every `\b` in ats.js was wrong in
 * the same way: 18 of 18 underscore-separated names matched nothing across five
 * adapters, while the bracket- and dot-separated ones in the fixtures matched
 * fine, so the tests were green.
 *
 * Rather than spell the lookarounds out forty times and rely on everyone
 * remembering, `\b` is translated here. That keeps ats.js readable, makes the
 * rule impossible to forget, and leaves one place to test.
 *
 * A `\b` is leading when it opens the pattern or an alternative, trailing
 * otherwise. Patterns needing an asymmetric guard — Workday's phone block has
 * to reject a trailing separator as well — still spell it out.
 */
export function compilePattern(pattern) {
  let out = "";

  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] !== "\\") {
      out += pattern[index];
      continue;
    }

    // Any other escape passes through whole, which also means an escaped
    // backslash consumes its pair — so a literal "\\" before a "b" stays a
    // literal backslash and a "b", rather than being read as a boundary.
    if (pattern[index + 1] !== "b") {
      out += pattern.slice(index, index + 2);
      index += 1;
      continue;
    }

    const previous = pattern[index - 1];
    const leading = index === 0 || previous === "|" || previous === "(";
    out += leading ? "(?<![A-Za-z0-9])" : "(?![A-Za-z0-9])";
    index += 1; // the "b"
  }

  return new RegExp(out, "i");
}

/**
 * Whether a field is disqualified from a path by that path's own vetoes.
 *
 * Applied to every hint, selectors included. An earlier version exempted
 * selectors on the grounds that each one names an exact attribute on a known
 * site and is hand-verified — which is true of `job_application[resume]` and
 * `legalName--firstName`, and not remotely true of `email` or `phone`. Those
 * are generic heuristics wearing an adapter's authority, and on a long form
 * they have a twin belonging to somebody else: `confirm_email`,
 * `emergency_phone`, `supervisor_phone`, `reference_email`.
 *
 * The vetoes exist for exactly those twins, so a hint has to clear them. A
 * genuinely site-specific selector passes anyway, because nothing disqualifying
 * appears in its field's text.
 */
function vetoed(path, descriptor) {
  const rule = RULE_BY_PATH.get(path);
  if (!rule?.veto.length) return false;

  // Checked against what the field says to a reader — its label, placeholder
  // and section — and not against the attribute names, which is what the
  // adapter just matched on and is entitled to interpret.
  //
  // That distinction is load-bearing in both directions. Workday's
  // state/province field is *named* `countryRegion`, and address.stateProvince
  // vetoes "country" to stop a field labelled "Country / Region" becoming a
  // state — so reading attribute names here would refuse the very field the
  // selector was written for. Meanwhile every dangerous twin announces itself
  // in its label: "Confirm email", "Emergency contact phone", "Supervisor
  // phone", "Reference email". The label is both the safer signal and the
  // honest one.
  const { label, placeholder, context } = descriptorTokens(descriptor);
  const visible = [...label, ...placeholder, ...context];

  return rule.veto.some((vetoTokens) => tokenCoverage(vetoTokens, visible) === 1);
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
        const test = compilePattern(pattern);
        for (const descriptor of descriptors) {
          const haystack = [
            descriptor.name,
            descriptor.id,
            descriptor.automationId ?? "",
            ...(descriptor.ancestorIds ?? []),
          ].join(" ");
          if (hints[descriptor.fieldId]) continue;
          if (!test.test(haystack)) continue;
          if (vetoed(path, descriptor)) continue;
          hints[descriptor.fieldId] = path;
        }
      }

      // Then the visible question, for sites whose attributes carry no meaning
      // at all. Lever names custom questions `cards[<uuid>][field7]` and Zoho
      // Recruit names every field `rec-form_<digits>`; on those the rendered
      // label is the only thing that identifies a field, and matching it
      // per-site is safer than loosening the global rules for everyone.
      for (const [pattern, path] of Object.entries(adapter.questions ?? {})) {
        const test = compilePattern(pattern);
        for (const descriptor of descriptors) {
          if (hints[descriptor.fieldId]) continue;
          if (!test.test(descriptor.label ?? "")) continue;
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
