/**
 * Coercing a stored value into what a particular control will accept.
 *
 * Knowing that a field wants your phone number is only half the job. The other
 * half is that this form wants `5551234567` while the last one wanted
 * `+1 (555) 123-4567` and rejected anything else; that this `<select>` lists
 * "USA" while you stored "United States"; and that "Are you authorised to work
 * here?" is a radio group whose options are "I am" and "I am not".
 *
 * Pure functions. Everything needed to decide is passed in.
 */

import { findRegion, COUNTRIES, US_STATES, CA_PROVINCES } from "./data/regions.js";
import { normalizeText, tokenCoverage, tokenize } from "./normalize.js";

/** Words meaning yes and no, in the phrasings application forms actually use. */
const AFFIRMATIVE = ["yes", "true", "y", "i am", "i do", "i have", "agree", "confirm", "authorized", "authorised", "eligible"];
const NEGATIVE = ["no", "false", "n", "i am not", "i do not", "i dont", "i have not", "disagree", "not authorized", "decline"];

/**
 * Interpret a stored value as a yes/no, or null if it is neither.
 *
 * Returning null rather than defaulting to false matters: an unanswered
 * question must stay unanswered, not silently become "No".
 */
export function toBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = normalizeText(value);
  if (!text) return null;
  if (AFFIRMATIVE.includes(text)) return true;
  if (NEGATIVE.includes(text)) return false;
  return null;
}

/** Today, as YYYY-MM-DD in local time. */
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Parse the date formats a profile might hold into parts.
 * @returns {{year: string, month: string, day: string} | null}
 */
function parseDate(value) {
  const text = String(value ?? "").trim();

  // ISO date or month, which is what the editor stores.
  const iso = text.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (iso) return { year: iso[1], month: iso[2], day: iso[3] ?? "01" };

  // A bare year, which people type into "graduation year" boxes.
  if (/^\d{4}$/.test(text)) return { year: text, month: "01", day: "01" };

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n) => String(n).padStart(2, "0");
    return { year: String(parsed.getFullYear()), month: pad(parsed.getMonth() + 1), day: pad(parsed.getDate()) };
  }
  return null;
}

/**
 * Render a date in the format a field wants.
 *
 * For a text input there is no declared format, so it is inferred from the
 * placeholder ("MM/DD/YYYY") when one exists. Guessing wrong here silently
 * produces a date that is off by months, so the fallback is ISO — the format
 * most likely to be either accepted or visibly rejected rather than
 * misinterpreted.
 */
export function formatDate(value, { type = "text", placeholder = "", maxLength } = {}) {
  const parts = parseDate(value);
  if (!parts) return "";

  if (type === "date") return `${parts.year}-${parts.month}-${parts.day}`;
  if (type === "month") return `${parts.year}-${parts.month}`;

  const hint = normalizeText(placeholder);
  if (hint.includes("dd mm yyyy") || hint.includes("dd mm yy")) return `${parts.day}/${parts.month}/${parts.year}`;
  if (hint.includes("mm dd yyyy") || hint.includes("mm dd yy")) return `${parts.month}/${parts.day}/${parts.year}`;
  if (hint.includes("mm yyyy")) return `${parts.month}/${parts.year}`;
  if (hint.includes("yyyy") && !hint.includes("mm")) return parts.year;

  // A four-character limit can only be a year.
  if (maxLength === 4) return parts.year;
  if (maxLength === 7) return `${parts.year}-${parts.month}`;

  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Render a phone number to fit a field's constraints.
 *
 * Forms are unusually strict about phone numbers, and the two common failures
 * are opposite: some reject anything but digits, others require the country
 * code. A `maxlength` or a `pattern` of digits is treated as a demand for bare
 * digits; otherwise the stored formatting is kept.
 */
export function formatPhone(value, { maxLength, pattern = "" } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  const digitsOnlyPattern = /^[\\^\[\]()?*+{}\d,\-]*(\\d|\[0-9\])/.test(pattern);

  if (digitsOnlyPattern) return digits;

  // A limit too small for the punctuation means they want digits only.
  if (maxLength && raw.length > maxLength) {
    if (digits.length <= maxLength) return digits;
    // Still too long: drop the country code, keeping the significant digits.
    return digits.slice(-maxLength);
  }

  return raw;
}

/** Strip a number down to what a numeric input accepts. */
export function formatNumber(value) {
  const cleaned = String(value ?? "").replace(/[^\d.\-]/g, "");
  return cleaned === "-" || cleaned === "." ? "" : cleaned;
}

/**
 * Choose the option that best represents `value`, from a control's own options.
 *
 * This is the workhorse for selects, radio groups and comboboxes. The order of
 * attempts is deliberate — exact identity first, then known equivalences
 * (country and state aliases, yes/no phrasings), then fuzzy token overlap. Fuzzy
 * matching last, and only above a threshold, because a confidently wrong
 * dropdown selection is both easy to make and hard to spot.
 *
 * @param {*} value           The stored value.
 * @param {string[]} options  The option labels offered by the control.
 * @param {{path?: string}} [context]
 * @returns {string | null}   The chosen option, or null to leave it alone.
 */
export function matchOption(value, options, { path = "" } = {}) {
  if (!options?.length) return null;

  const values = Array.isArray(value) ? value : [value];
  for (const candidate of values) {
    const found = matchOne(candidate, options, path);
    if (found) return found;
  }
  return null;
}

/**
 * Polarity of an option's own wording, or null if it is not a yes/no answer.
 *
 * Negatives are tested first and longest-first, because affirmative phrases are
 * prefixes of their own negations: "I am not authorized" begins with "I am",
 * and matching that as a yes selects the exact opposite of the intended answer.
 */
function optionPolarity(text) {
  const matches = (phrases) =>
    [...phrases]
      .sort((a, b) => b.length - a.length)
      .some((phrase) => text === phrase || text.startsWith(`${phrase} `));

  if (matches(NEGATIVE)) return false;
  if (matches(AFFIRMATIVE)) return true;
  return null;
}

/** Strip to letters and digits only, so "bachelor's" and "bachelors" agree. */
const compact = (text) => normalizeText(text).replace(/ /g, "");

function matchOne(value, options, path) {
  const wanted = normalizeText(value);
  if (!wanted) return null;

  const normalised = options.map((option) => ({ option, text: normalizeText(option) }));

  // 1. Exact, then exact ignoring word breaks and possessives.
  const exact = normalised.find((o) => o.text === wanted);
  if (exact) return exact.option;

  const wantedCompact = compact(value);
  const compacted = normalised.find((o) => compact(o.option) === wantedCompact);
  if (compacted) return compacted.option;

  // 2. Country and region aliases, so a stored "United States" finds "USA".
  if (/country/i.test(path)) {
    const region = findRegion(value, COUNTRIES);
    if (region) {
      const hit = normalised.find(
        (o) => normalizeText(o.option) === normalizeText(region.name) ||
               region.aliases.some((alias) => normalizeText(alias) === o.text)
      );
      if (hit) return hit.option;
    }
  }
  if (/state|province/i.test(path)) {
    for (const list of [US_STATES, CA_PROVINCES]) {
      const region = findRegion(value, list);
      if (!region) continue;
      const hit = normalised.find(
        (o) => o.text === normalizeText(region.name) || region.aliases.some((a) => normalizeText(a) === o.text)
      );
      if (hit) return hit.option;
    }
  }

  // 3. Yes/no, where the option wording may be "I am" / "I am not".
  const bool = toBoolean(value);
  if (bool !== null) {
    const hit = normalised.find((o) => optionPolarity(o.text) === bool);
    if (hit) return hit.option;
  }

  // 4. One option contains the whole stored value, or vice versa. Guarded by a
  // length check so "No" does not match "Not applicable".
  const substring = normalised.find(
    (o) => (o.text.includes(wanted) || wanted.includes(o.text)) && Math.abs(o.text.length - wanted.length) <= 12
  );
  if (substring) return substring.option;

  // 5. Fuzzy token overlap, above a deliberately high bar.
  const wantedTokens = tokenize(value);
  let best = null;
  for (const { option, text } of normalised) {
    const coverage = tokenCoverage(wantedTokens, tokenize(text));
    if (coverage >= 0.7 && (!best || coverage > best.coverage)) best = { option, coverage };
  }
  return best?.option ?? null;
}

/**
 * Turn a matched value into the instruction the content script will carry out.
 *
 * @param {object} options
 * @param {*} options.value            The stored value.
 * @param {string} options.path        Canonical path, used for context.
 * @param {object} options.descriptor  The field descriptor from the page.
 * @returns {{kind: "text"|"option"|"boolean"|"file", value: *} | null}
 *   Null means the value cannot be expressed in this control and it should be
 *   left alone rather than filled with something approximate.
 */
export function formatForField({ value, path, descriptor }) {
  const { type = "text", tag = "input", options, placeholder, maxLength, pattern } = descriptor;

  // The signature date is stored as an instruction, not a date, so that it is
  // always the day the form is actually filled.
  const resolved = value === "Today's date" ? today() : value;
  if (resolved === "Leave blank") return null;

  // --- Controls that offer a fixed set of answers.
  if (tag === "select" || type === "radio" || type === "combobox" || (options?.length && type !== "checkbox")) {
    const option = matchOption(resolved, options, { path });
    return option ? { kind: "option", value: option } : null;
  }

  if (type === "checkbox") {
    // A checkbox group with options behaves like a multi-select.
    if (options?.length) {
      const option = matchOption(resolved, options, { path });
      return option ? { kind: "option", value: option } : null;
    }
    const bool = toBoolean(resolved);
    return bool === null ? null : { kind: "boolean", value: bool };
  }

  if (type === "file") {
    return { kind: "file", value: path };
  }

  // --- Free text, formatted to the field's constraints.
  if (type === "date" || type === "month" || /date|birth|graduat/i.test(path)) {
    const formatted = formatDate(resolved, { type, placeholder, maxLength });
    return formatted ? { kind: "text", value: formatted } : null;
  }

  if (type === "tel" || /phone/i.test(path)) {
    const formatted = formatPhone(resolved, { maxLength, pattern });
    return formatted ? { kind: "text", value: formatted } : null;
  }

  if (type === "number") {
    const formatted = formatNumber(resolved);
    return formatted ? { kind: "text", value: formatted } : null;
  }

  // Tag lists become comma-separated text, which is what a skills box expects.
  const text = Array.isArray(resolved) ? resolved.join(", ") : String(resolved ?? "");
  if (!text.trim()) return null;

  // Respect a maxlength rather than letting the browser truncate mid-word.
  return { kind: "text", value: maxLength && text.length > maxLength ? text.slice(0, maxLength) : text };
}
