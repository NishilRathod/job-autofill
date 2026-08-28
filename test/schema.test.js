/**
 * Invariants for the field schema.
 *
 * schema.js drives the options editor, the matcher and the generated docs, so a
 * malformed entry breaks all three at once and usually in a confusing way.
 * These tests are cheap insurance against a typo in a 105-field table.
 */

import { describe, it, expect } from "vitest";
import {
  SECTIONS,
  ALL_FIELDS,
  FIELD_BY_PATH,
  getField,
  parsePath,
  NEVER_AUTOFILL,
} from "../src/core/schema.js";
import { emptyProfile, defaultSettings, defaultState } from "../src/core/defaults.js";

const VALID_TYPES = new Set([
  "text", "email", "tel", "url", "date", "month", "number",
  "textarea", "select", "multiselect", "boolean", "file", "tags",
]);

describe("schema structure", () => {
  it("has unique section ids", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique canonical paths across every section", () => {
    const paths = ALL_FIELDS.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it.each(SECTIONS.map((s) => [s.id, s]))("section %s is well formed", (_id, section) => {
    expect(section.label).toBeTruthy();
    expect(section.fields.length).toBeGreaterThan(0);

    // Field keys need only be unique within their section, since the section id
    // prefixes them — "work.location" and "education.location" both exist.
    const keys = section.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);

    if (section.repeating) {
      expect(section.itemLabel, `${section.id} repeats, so it needs an itemLabel`).toBeTruthy();
      expect(section.maxItems).toBeGreaterThan(0);
    }
  });

  it.each(ALL_FIELDS.map((f) => [f.path, f]))("field %s is well formed", (_path, field) => {
    expect(field.label, "every field needs a label for the editor").toBeTruthy();
    expect(VALID_TYPES.has(field.type), `unknown type "${field.type}"`).toBe(true);

    // A select the user cannot choose from is a text box with extra steps.
    if (field.type === "select" || field.type === "multiselect") {
      expect(field.options?.length, `${field.path} needs options`).toBeGreaterThan(0);
      expect(new Set(field.options).size).toBe(field.options.length);
    }
  });

  it("marks every field in a sensitive section as sensitive", () => {
    // The demographics gate checks the field flag, not the section, so a field
    // that failed to inherit it would be filled without consent.
    const demographics = ALL_FIELDS.filter((f) => f.sectionId === "demographics");
    expect(demographics.length).toBeGreaterThan(0);
    expect(demographics.every((f) => f.sensitive)).toBe(true);
  });

  it("keeps sensitive fields confined to the demographics section", () => {
    // Work authorisation and sponsorship are screening questions, not protected
    // characteristics, and are meant to fill by default. If one ever gets
    // flagged sensitive it would silently stop filling.
    const sections = new Set(ALL_FIELDS.filter((f) => f.sensitive).map((f) => f.sectionId));
    expect([...sections]).toEqual(["demographics"]);
  });

  it("offers a decline-to-answer option on every demographic question", () => {
    const declining = /prefer not|do not wish|not to answer|do not want/i;
    for (const field of ALL_FIELDS.filter((f) => f.sensitive && f.options)) {
      expect(
        field.options.some((o) => declining.test(o)),
        `${field.path} must let the user decline`
      ).toBe(true);
    }
  });

  it("lists criminal-history phrasings as never-autofill", () => {
    expect(NEVER_AUTOFILL.length).toBeGreaterThan(0);
    expect(NEVER_AUTOFILL.some((p) => p.includes("convict"))).toBe(true);
  });
});

describe("path helpers", () => {
  it("parses a simple path", () => {
    expect(parsePath("identity.email")).toEqual({ sectionId: "identity", index: null, key: "email" });
  });

  it("parses an indexed path from a repeating section", () => {
    expect(parsePath("work.2.company")).toEqual({ sectionId: "work", index: 2, key: "company" });
  });

  it("resolves a field definition from an indexed path", () => {
    // The matcher works with concrete paths but the schema defines each
    // repeating field once, so this stripping has to work.
    expect(getField("work.2.company")).toBe(FIELD_BY_PATH.get("work.company"));
    expect(getField("education.0.school").label).toBe("School or university");
  });

  it("returns undefined for an unknown path rather than throwing", () => {
    expect(getField("nope.nothing")).toBeUndefined();
  });
});

describe("empty profile", () => {
  const profile = emptyProfile();

  it("has an entry for every section", () => {
    for (const section of SECTIONS) {
      expect(profile[section.id], `missing ${section.id}`).toBeDefined();
    }
  });

  it("starts repeating sections as arrays holding one blank entry", () => {
    // The editor needs a row to render; an empty array shows only an Add button.
    for (const section of SECTIONS.filter((s) => s.repeating)) {
      expect(Array.isArray(profile[section.id])).toBe(true);
      expect(profile[section.id]).toHaveLength(1);
    }
  });

  it("defaults every demographic answer to declining", () => {
    // This is the guarantee that matters most here: even a user who enables the
    // demographics setting without editing anything discloses nothing.
    const declining = /prefer not|do not wish|not to answer|do not want/i;
    for (const [key, value] of Object.entries(profile.demographics)) {
      const actual = Array.isArray(value) ? value.join(" ") : value;
      expect(declining.test(actual), `demographics.${key} defaults to "${actual}"`).toBe(true);
    }
  });

  it("returns an independent object each call", () => {
    // A shared reference would let one profile's edits leak into a reset.
    const a = emptyProfile();
    const b = emptyProfile();
    a.identity.firstName = "mutated";
    a.demographics.raceEthnicity.push("mutated");
    expect(b.identity.firstName).toBe("");
    expect(b.demographics.raceEthnicity).toEqual(["Prefer not to say"]);
  });

  it("uses type-appropriate blanks", () => {
    expect(profile.work[0].currentlyWorking).toBe(false); // boolean
    expect(profile.skills.skills).toEqual([]); // tags
    expect(profile.documents.resume).toBeNull(); // file metadata
    expect(profile.identity.firstName).toBe(""); // text
  });
});

describe("default settings", () => {
  it("ships with demographics filling turned off", () => {
    // The single most important default in the extension.
    expect(defaultSettings().fillDemographics).toBe(false);
  });

  it("does not overwrite values already present in a form", () => {
    expect(defaultSettings().overwriteExisting).toBe(false);
  });

  it("includes a schema version in the default state", () => {
    expect(defaultState().schemaVersion).toBeGreaterThanOrEqual(1);
  });
});
