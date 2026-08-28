/**
 * Values computed from other values.
 *
 * Some fields are asked for in a shape the user should not have to retype. A
 * form wanting one "Full name" box, or a single "Location" line, can be served
 * from parts already entered. Storing those separately would mean a user who
 * changes their surname has to remember to update three fields.
 *
 * The rule: a derived field is used only when the user has left it blank. An
 * explicit value always wins, because the derivation cannot know that someone
 * publishes under a different name than the one on their passport.
 */

import { parsePath } from "./schema.js";

/** Join parts, dropping blanks, with no doubled separators. */
const join = (parts, separator = " ") =>
  parts.map((p) => String(p ?? "").trim()).filter(Boolean).join(separator);

/**
 * How each derived field is computed.
 * @type {Record<string, (profile: object) => string>}
 */
const DERIVATIONS = {
  /**
   * Includes the middle name when there is one. Forms asking for a "full name"
   * are usually asking for the legal name, which is the version that has to
   * match identity documents in a later background check.
   */
  "identity.fullName": (p) =>
    join([p.identity?.firstName, p.identity?.middleName, p.identity?.lastName]),

  /** For forms with a single free-text "Location" box. */
  "address.currentLocationText": (p) =>
    join([p.address?.city, p.address?.stateProvince, p.address?.country], ", "),

  /**
   * The typed signature at the bottom of an application. Chained off
   * identity.fullName so it picks up an explicit override there too.
   */
  "signature.signatureFullName": (p) =>
    String(p.identity?.fullName || "").trim() || DERIVATIONS["identity.fullName"](p),
};

/** Whether a path is computed rather than typed. */
export function isDerived(path) {
  return path in DERIVATIONS;
}

/**
 * Compute a derived field from the rest of the profile.
 * @returns {string} The computed value, or "" if the inputs are blank too.
 */
export function derive(path, profile) {
  return DERIVATIONS[path]?.(profile ?? {}) ?? "";
}

/**
 * The value to actually use for a path: what the user typed, or the derivation
 * when they left it blank.
 *
 * This is the function the matcher calls. Everything else about derived fields
 * is presentation.
 */
export function resolveValue(path, profile) {
  const { sectionId, index, key } = parsePath(path);
  const container = index === null ? profile?.[sectionId] : profile?.[sectionId]?.[index];
  const stored = container?.[key];

  // Only strings can be blank-and-derivable; arrays and booleans are used as-is.
  if (typeof stored === "string" && stored.trim() === "" && isDerived(path)) {
    return derive(path, profile);
  }
  return stored ?? "";
}
