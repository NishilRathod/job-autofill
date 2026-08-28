/**
 * End-to-end matching against realistic ATS form markup.
 *
 * The unit tests in matcher.test.js feed hand-written descriptors, which proves
 * the scoring works but not that the collector produces the descriptors the
 * scorer expects. These tests close that gap: real HTML in, a fill plan out.
 *
 * This is the suite that catches an entire ATS silently breaking.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { match } from "../src/core/matcher.js";
import { emptyProfile, defaultSettings } from "../src/core/defaults.js";
import { loadContentScripts, loadFixture } from "./helpers/load-content-script.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => readFileSync(resolve(ROOT, "test/fixtures", name), "utf8");

/** A realistic, fully populated profile. */
function fullProfile() {
  const profile = emptyProfile();
  Object.assign(profile.identity, {
    firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+1 555 123 4567",
  });
  Object.assign(profile.address, { city: "London", country: "United Kingdom" });
  Object.assign(profile.links, {
    linkedin: "https://linkedin.com/in/ada",
    github: "https://github.com/ada",
    portfolio: "https://ada.example.com",
  });
  Object.assign(profile.eligibility, { authorizedToWork: "Yes", requiresSponsorship: "No" });
  profile.work[0] = {
    ...profile.work[0],
    company: "Analytical Engines", title: "Principal Engineer",
    startDate: "2020-03", endDate: "2024-01",
  };
  profile.education[0] = {
    ...profile.education[0],
    school: "University of London", fieldOfStudy: "Mathematics", startDate: "2014-09",
  };
  profile.screening.howDidYouHearAboutUs = "LinkedIn";
  profile.demographics.gender = "Female";
  // Document slots hold metadata; the blob itself lives in IndexedDB.
  profile.documents.resume = { name: "ada-lovelace-cv.pdf", size: 240000, type: "application/pdf", savedAt: new Date().toISOString() };
  return profile;
}

/** Collect a fixture and run the matcher over it. */
function planFor(html, { profile = fullProfile(), settings = {} } = {}) {
  loadFixture(html);
  const { descriptors } = loadContentScripts("collect.js").collect(document);
  return {
    descriptors,
    ...match({ descriptors, profile, settings: { ...defaultSettings(), ...settings } }),
  };
}

/** What got written into the element carrying this id. */
const forId = (result, id) => result.fills.find((f) => {
  const descriptor = result.descriptors.find((d) => d.fieldId === f.fieldId);
  return descriptor?.id === id;
});

describe("Greenhouse-style application form", () => {
  let result;
  beforeEach(() => {
    result = planFor(fixture("greenhouse.html"));
  });

  it("collects every field on the form", () => {
    // 10 text/file inputs, 2 selects, 1 textarea, 3 EEO selects.
    expect(result.descriptors.length).toBeGreaterThanOrEqual(16);
  });

  it("reads the labels the form actually renders", () => {
    const labels = result.descriptors.map((d) => d.label);
    expect(labels).toContain("First Name");
    expect(labels).toContain("LinkedIn Profile");
    expect(labels).toContain("Are you legally authorized to work in the United States?");
  });

  it("strips the required asterisk out of a label", () => {
    // Left in, it becomes a token and dilutes every match on the field.
    expect(result.descriptors.find((d) => d.id === "first_name").label).toBe("First Name");
  });

  it.each([
    ["first_name", "identity.firstName", "Ada"],
    ["last_name", "identity.lastName", "Lovelace"],
    ["email", "identity.email", "ada@example.com"],
    ["urls_LinkedIn", "links.linkedin", "https://linkedin.com/in/ada"],
    ["urls_GitHub", "links.github", "https://github.com/ada"],
    ["urls_Portfolio", "links.portfolio", "https://ada.example.com"],
  ])("fills #%s from %s", (id, path, value) => {
    const fill = forId(result, id);
    expect(fill?.path).toBe(path);
    expect(fill?.value).toBe(value);
  });

  it("answers authorisation and sponsorship the right way round", () => {
    // The most consequential pair on any US application form.
    expect(forId(result, "q_auth")?.value).toBe("Yes");
    expect(forId(result, "q_sponsor")?.value).toBe("No");
  });

  it("recognises the resume upload", () => {
    expect(forId(result, "resume")?.path).toBe("documents.resume");
  });

  it("does not put the resume in the cover letter slot", () => {
    expect(forId(result, "cover_letter")?.path).not.toBe("documents.resume");
  });

  it("leaves the company-specific question for the applicant", () => {
    // Nothing in a profile answers "the most interesting system you have
    // debugged", so guessing would be worse than reporting it.
    const custom = result.descriptors.find((d) => d.id === "q_custom");
    expect(result.fills.some((f) => f.fieldId === custom.fieldId)).toBe(false);
    expect(result.unmatched.some((u) => u.fieldId === custom.fieldId)).toBe(true);
  });

  it("withholds every EEO answer by default", () => {
    for (const id of ["gender", "hispanic_ethnicity", "veteran_status"]) {
      expect(forId(result, id)).toBeUndefined();
    }
    expect(result.skipped.some((s) => /self-identification/i.test(s.reason))).toBe(true);
  });

  it("fills EEO answers once the user opts in", () => {
    const opted = planFor(fixture("greenhouse.html"), { settings: { fillDemographics: true } });
    expect(forId(opted, "gender")?.value).toBe("Female");
  });

  it("gives each filled field a distinct profile path", () => {
    const paths = result.fills.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("explains every fill in words a person can check", () => {
    for (const fill of result.fills) {
      expect(fill.reason, `${fill.path} has no reason`).toBeTruthy();
      expect(fill.label).toBeTruthy();
    }
  });
});

describe("Workday-style form with custom widgets", () => {
  let result;
  beforeEach(() => {
    result = planFor(fixture("workday.html"));
  });

  it("finds fields labelled by a sibling div rather than a <label>", () => {
    // Workday associates nothing; the label is a neighbouring element. A
    // collector that only reads <label for> sees an unlabelled form.
    const labels = result.descriptors.map((d) => d.label);
    expect(labels).toContain("First Name");
    expect(labels).toContain("Email Address");
  });

  it("collects a button-based combobox as a fillable field", () => {
    const country = result.descriptors.find((d) => d.id === "country-button");
    expect(country).toBeDefined();
    expect(country.options).toContain("United Kingdom");
  });

  it("fills through data-automation-id naming", () => {
    expect(forId(result, "input-1")?.path).toBe("identity.firstName");
    expect(forId(result, "input-3")?.path).toBe("identity.email");
  });

  it("keeps two employment blocks in separate profile entries", () => {
    const companies = result.fills.filter((f) => f.path.endsWith(".company"));
    expect(new Set(companies.map((f) => f.path)).size).toBe(companies.length);
  });

  it("tells an education start date apart from an employment one", () => {
    // Identical labels; only the surrounding heading distinguishes them.
    const work = forId(result, "work-start");
    const education = forId(result, "edu-start");
    expect(work?.path).toMatch(/^work\./);
    expect(education?.path).toMatch(/^education\./);
  });
});

describe("hostile markup", () => {
  it("ignores hidden, disabled and button inputs", () => {
    const { descriptors } = planFor(`
      <input type="hidden" name="csrf_token" />
      <input type="submit" value="Apply" />
      <input type="button" value="Add another" />
      <input type="text" name="first_name" disabled />
      <input type="text" name="email" />
    `);
    const names = descriptors.map((d) => d.name);
    expect(names).not.toContain("csrf_token");
    expect(names).toContain("email");
    // A disabled field is collected but flagged, so the popup can explain it.
    expect(descriptors.find((d) => d.name === "first_name")?.disabled).toBe(true);
  });

  it("treats a radio group as one question, not one field per option", () => {
    const { descriptors, fills } = planFor(`
      <fieldset>
        <legend>Are you legally authorized to work in the United States?</legend>
        <label><input type="radio" name="auth" value="1" /> Yes</label>
        <label><input type="radio" name="auth" value="0" /> No</label>
      </fieldset>
    `);
    const group = descriptors.filter((d) => d.name === "auth");
    expect(group).toHaveLength(1);
    expect(group[0].options).toEqual(["Yes", "No"]);
    expect(fills[0]?.value).toBe("Yes");
  });

  it("finds a field inside a shadow root", () => {
    // Some vendors render the whole form inside a web component, where a plain
    // querySelectorAll returns nothing at all.
    loadFixture(`<div id="host"></div>`);
    const shadow = document.getElementById("host").attachShadow({ mode: "open" });
    shadow.innerHTML = `<label for="e">Email</label><input id="e" type="email" />`;

    const { descriptors } = loadContentScripts("collect.js").collect(document);
    expect(descriptors.some((d) => d.label === "Email")).toBe(true);
  });

  it("does not fall over on a page with no form at all", () => {
    const result = planFor("<p>No jobs here.</p>");
    expect(result.descriptors).toEqual([]);
    expect(result.fills).toEqual([]);
  });

  it("reports a field that already has a value as skipped, not overwritten", () => {
    loadFixture(`<label for="e">Email</label><input id="e" type="email" value="someone@else.com" />`);
    const { descriptors } = loadContentScripts("collect.js").collect(document);
    const { fills, skipped } = match({
      descriptors, profile: fullProfile(), settings: defaultSettings(),
    });
    expect(fills).toHaveLength(0);
    expect(skipped[0].reason).toBe("Already has a value");
  });
});
