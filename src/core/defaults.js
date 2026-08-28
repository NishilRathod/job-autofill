/**
 * The empty profile a new user starts from, plus default settings.
 *
 * Built from the schema rather than written out by hand, so a field added to
 * schema.js automatically exists in every new profile and in every migration.
 */

import { SECTIONS } from "./schema.js";

/** Current shape version of stored data. Bump when a migration is added. */
export const SCHEMA_VERSION = 1;

/**
 * Values a new profile starts with, keyed by canonical path.
 *
 * The demographics defaults are the important ones: every protected-class field
 * starts at the most private answer available, so that even if a user turns the
 * demographics setting on without editing anything, JobFill discloses nothing.
 */
const SEED_VALUES = {
  "demographics.gender": "Prefer not to say",
  "demographics.hispanicOrLatino": "Prefer not to say",
  "demographics.raceEthnicity": ["Prefer not to say"],
  "demographics.veteranStatus": "I do not wish to answer",
  "demographics.disabilityStatus": "I do not want to answer",
  "demographics.sexualOrientation": "Prefer not to say",
  "demographics.transgenderIdentity": "Prefer not to say",

  // Almost every application ends with a typed signature and today's date.
  "signature.signatureDate": "Today's date",
};

/** The blank value for a field, appropriate to its type. */
function emptyValueFor(field) {
  switch (field.type) {
    case "boolean":
      return false;
    case "multiselect":
    case "tags":
      return [];
    case "file":
      // Files live in IndexedDB, not in the profile object. This holds the
      // metadata (name, size, type) so the UI can show what is stored without
      // loading the blob.
      return null;
    default:
      return "";
  }
}

/**
 * A blank profile matching the current schema.
 *
 * Repeating sections start with one empty entry, so the editor has something to
 * show rather than an empty panel with only an "Add" button.
 *
 * @returns {object} A fresh object — never a shared reference.
 */
export function emptyProfile() {
  const profile = {};

  for (const section of SECTIONS) {
    const entry = {};
    for (const field of section.fields) {
      const path = `${section.id}.${field.key}`;
      entry[field.key] = SEED_VALUES[path] ?? emptyValueFor(field);
    }
    // Structured-clone the seeded entry so array defaults (raceEthnicity, tags)
    // are not shared between the template and the profile.
    profile[section.id] = section.repeating
      ? [structuredClone(entry)]
      : structuredClone(entry);
  }

  return profile;
}

/**
 * Default settings.
 *
 * The one that matters is `fillDemographics: false`. Protected-class answers
 * are stored but never written to a page unless the user opts in explicitly.
 */
export function defaultSettings() {
  return {
    /** Fill the voluntary self-identification section. Off by design. */
    fillDemographics: false,

    /**
     * Replace values already present in a form. Off, because a partially
     * completed application is the case where clobbering hurts most.
     */
    overwriteExisting: false,

    /** Show the field-by-field preview before writing. The hotkey bypasses it. */
    showPreview: true,

    /** Briefly outline each field JobFill wrote, so the result is visible. */
    highlightFilled: true,

    /** Attach stored documents to file inputs. */
    attachDocuments: true,

    /**
     * Minimum match confidence (0-100) required to fill a field. Lower catches
     * more fields and makes more mistakes. 55 corresponds to a name/id token
     * match, which is the weakest signal worth acting on unaided.
     */
    confidenceThreshold: 55,
  };
}

/** The complete stored state for a brand-new installation. */
export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: emptyProfile(),
    settings: defaultSettings(),
    /** Reusable answers for open-ended questions. See core/snippets.js. */
    snippets: [],
    /**
     * Field mappings the user has taught JobFill, keyed by domain and then by
     * field signature. Scoped per-domain so a correction on one job board
     * cannot leak onto an unrelated site.
     * @type {Record<string, Record<string, string>>}
     */
    mappings: {},
  };
}
