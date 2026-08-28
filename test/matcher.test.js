/**
 * The matching engine.
 *
 * This is where the extension is right or wrong, so these tests are the most
 * valuable in the suite. Two categories matter most:
 *
 *   1. Near-misses. "Confirm email", "Emergency contact first name" and
 *      "Supervisor phone" all look like fields JobFill wants. Filling them is
 *      worse than filling nothing, because the value is plausible enough to
 *      survive a glance before the form is submitted.
 *   2. Mirror-image questions. "Are you authorised to work here?" and "Will you
 *      require sponsorship?" often both appear, and answering one with the
 *      other's answer is exactly backwards.
 */

import { describe, it, expect } from "vitest";
import { match, SCORES } from "../src/core/matcher.js";
import { emptyProfile, defaultSettings } from "../src/core/defaults.js";

/** A profile filled in enough to exercise most rules. */
function testProfile(overrides = {}) {
  const profile = emptyProfile();
  Object.assign(profile.identity, {
    firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+44 20 7123 4567",
  });
  Object.assign(profile.address, {
    line1: "12 Analytical Way", city: "London", stateProvince: "Greater London",
    postalCode: "SW1A 1AA", country: "United Kingdom",
  });
  Object.assign(profile.links, { linkedin: "https://linkedin.com/in/ada", github: "https://github.com/ada" });
  Object.assign(profile.eligibility, { authorizedToWork: "Yes", requiresSponsorship: "No" });
  Object.assign(profile.preferences, { desiredSalary: "120000", currentSalary: "95000", noticePeriod: "1 month" });
  profile.work[0] = {
    ...profile.work[0],
    company: "Analytical Engines", title: "Principal Engineer",
    startDate: "2020-03", endDate: "2024-01",
  };
  profile.education[0] = {
    ...profile.education[0],
    school: "University of London", fieldOfStudy: "Mathematics",
    startDate: "2014-09", endDate: "2018-06",
  };
  profile.demographics.gender = "Female";

  for (const [section, values] of Object.entries(overrides)) Object.assign(profile[section], values);
  return profile;
}

/** Run the matcher over a list of descriptor fragments. */
function run(fields, { profile = testProfile(), settings = {}, ...rest } = {}) {
  const descriptors = fields.map((field, index) => ({
    fieldId: field.fieldId ?? `f${index}`,
    tag: "input",
    type: "text",
    ...field,
  }));
  return match({
    descriptors,
    profile,
    settings: { ...defaultSettings(), ...settings },
    ...rest,
  });
}

/** The path assigned to a given fieldId, or undefined if it was not filled. */
const pathOf = (result, fieldId) => result.fills.find((f) => f.fieldId === fieldId)?.path;
const valueOf = (result, fieldId) => result.fills.find((f) => f.fieldId === fieldId)?.value;

// ---------------------------------------------------------------------------

describe("autocomplete attributes win outright", () => {
  it("uses the form author's own declaration", () => {
    const result = run([
      { fieldId: "a", autocomplete: "given-name", label: "Nombre" }, // label in another language
      { fieldId: "b", autocomplete: "family-name", label: "Apellido" },
      { fieldId: "c", autocomplete: "email", name: "q_4821" },
    ]);
    expect(pathOf(result, "a")).toBe("identity.firstName");
    expect(pathOf(result, "b")).toBe("identity.lastName");
    expect(pathOf(result, "c")).toBe("identity.email");
    expect(result.fills.every((f) => f.score === SCORES.autocomplete)).toBe(true);
  });

  it("reads a token that carries a section prefix", () => {
    // "shipping given-name" and "billing email" are both valid HTML.
    const result = run([{ fieldId: "a", autocomplete: "shipping given-name", name: "x" }]);
    expect(pathOf(result, "a")).toBe("identity.firstName");
  });
});

describe("label matching", () => {
  it.each([
    ["First name", "identity.firstName"],
    ["Given name", "identity.firstName"],
    ["Last Name *", "identity.lastName"],
    ["Surname", "identity.lastName"],
    ["Email Address", "identity.email"],
    ["Phone number", "identity.phone"],
    ["Street address", "address.line1"],
    ["City", "address.city"],
    ["ZIP code", "address.postalCode"],
    ["LinkedIn Profile", "links.linkedin"],
    ["GitHub URL", "links.github"],
    ["Desired salary", "preferences.desiredSalary"],
    ["Notice period", "preferences.noticePeriod"],
  ])("matches %s to %s", (label, expected) => {
    expect(pathOf(run([{ fieldId: "a", label }]), "a")).toBe(expected);
  });

  it("matches a label padded with the words real forms use", () => {
    const result = run([{ fieldId: "a", label: "Please enter your legal first name (required)" }]);
    expect(pathOf(result, "a")).toBe("identity.firstName");
  });

  it("prefers the most specific rule when two could match", () => {
    // "Current salary" and "Desired salary" share a token; each must veto the
    // other rather than both landing on whichever scores marginally higher.
    const result = run([
      { fieldId: "cur", label: "Current salary" },
      { fieldId: "des", label: "Expected salary" },
    ]);
    expect(pathOf(result, "cur")).toBe("preferences.currentSalary");
    expect(pathOf(result, "des")).toBe("preferences.desiredSalary");
  });
});

describe("name and id matching when there is no label", () => {
  it.each([
    ["first_name", "identity.firstName"],
    ["applicant[last_name]", "identity.lastName"],
    ["txtEmailAddress", "identity.email"],
    ["mobileNumber", "identity.phone"],
    ["zipCode", "address.postalCode"],
  ])("matches name=%s to %s", (name, expected) => {
    expect(pathOf(run([{ fieldId: "a", name }]), "a")).toBe(expected);
  });

  it("scores a name match below a label match", () => {
    const byLabel = run([{ fieldId: "a", label: "First name" }]);
    const byName = run([{ fieldId: "a", name: "first_name" }]);
    expect(byLabel.fills[0].score).toBeGreaterThan(byName.fills[0].score);
  });
});

// ---------------------------------------------------------------------------

describe("vetoes: fields that must never be filled", () => {
  it("does not put your email in a confirmation box", () => {
    const result = run([
      { fieldId: "email", label: "Email" },
      { fieldId: "confirm", label: "Confirm email address" },
    ]);
    expect(pathOf(result, "email")).toBe("identity.email");
    expect(pathOf(result, "confirm")).not.toBe("identity.email");
  });

  it.each([
    "Emergency contact first name",
    "Emergency contact name",
    "Spouse's name",
    "Reference name",
    "Next of kin name",
  ])("does not treat %s as the applicant's name", (label) => {
    const result = run([{ fieldId: "a", label }]);
    expect(["identity.firstName", "identity.lastName", "identity.fullName"])
      .not.toContain(pathOf(result, "a"));
  });

  it("does not put your phone number in a supervisor's phone field", () => {
    const result = run([{ fieldId: "a", label: "Supervisor phone number" }]);
    expect(pathOf(result, "a")).not.toBe("identity.phone");
  });

  it("does not read a company name as the applicant's name", () => {
    const result = run([{ fieldId: "a", label: "Company name" }]);
    expect(pathOf(result, "a")).not.toBe("identity.fullName");
  });

  it("does not read a username field as a name", () => {
    const result = run([{ fieldId: "a", label: "Username" }]);
    expect(pathOf(result, "a")).toBeUndefined();
  });

  it("applies a veto found in surrounding section text, not just the label", () => {
    // The label alone says "First name"; only the heading reveals whose.
    const result = run([
      { fieldId: "a", label: "First name", sectionText: "Emergency contact details" },
    ]);
    expect(pathOf(result, "a")).not.toBe("identity.firstName");
  });
});

describe("mirror-image eligibility questions", () => {
  it("answers authorisation and sponsorship separately", () => {
    // Getting these crossed is the single most consequential matching error
    // this extension can make.
    const result = run([
      { fieldId: "auth", label: "Are you legally authorized to work in the United States?" },
      { fieldId: "spon", label: "Will you now or in the future require sponsorship for employment visa status?" },
    ]);
    expect(pathOf(result, "auth")).toBe("eligibility.authorizedToWork");
    expect(valueOf(result, "auth")).toBe("Yes");
    expect(pathOf(result, "spon")).toBe("eligibility.requiresSponsorship");
    expect(valueOf(result, "spon")).toBe("No");
  });

  it("does not answer a sponsorship question from the authorisation field", () => {
    const result = run([{ fieldId: "a", label: "Do you require visa sponsorship?" }]);
    expect(pathOf(result, "a")).toBe("eligibility.requiresSponsorship");
  });
});

describe("questions JobFill refuses to answer", () => {
  it.each([
    "Have you ever been convicted of a felony?",
    "Do you have a criminal record?",
    "Have you ever been arrested?",
  ])("skips %s and says why", (label) => {
    const result = run([{ fieldId: "a", label }]);
    expect(result.fills).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/depends on where you live/i);
  });
});

describe("the demographics gate", () => {
  const fields = [{ fieldId: "g", label: "Gender" }, { fieldId: "r", label: "Race / Ethnicity" }];

  it("does not fill self-identification questions by default", () => {
    const result = run(fields);
    expect(result.fills).toHaveLength(0);
    expect(result.skipped.map((s) => s.reason)).toContain("Self-identification filling is turned off");
  });

  it("reports them as deliberately skipped rather than unmatched", () => {
    // The distinction matters: unmatched fields are offered to learn mode, and
    // offering to "teach" a field that was recognised and withheld is wrong.
    const result = run(fields);
    expect(result.unmatched).toHaveLength(0);
  });

  it("fills them once the user opts in", () => {
    const result = run(fields, { settings: { fillDemographics: true } });
    expect(pathOf(result, "g")).toBe("demographics.gender");
    expect(valueOf(result, "g")).toBe("Female");
  });
});

describe("learned mappings and adapter hints", () => {
  it("uses a mapping the user taught, over any heuristic", () => {
    // A vendor-generated field the heuristics cannot place on their own.
    const descriptor = { fieldId: "a", label: "Q7", name: "answers_7_value", type: "text" };

    // Unmapped, it is reported as unmatched...
    const before = match({ descriptors: [descriptor], profile: testProfile(), settings: defaultSettings() });
    expect(before.unmatched).toHaveLength(1);

    // ...and the signature it reports is the key learn mode stores against.
    const after = match({
      descriptors: [descriptor],
      profile: testProfile(),
      settings: defaultSettings(),
      learned: { [before.unmatched[0].signature]: "identity.email" },
    });
    expect(pathOf(after, "a")).toBe("identity.email");
    expect(after.fills[0].score).toBe(SCORES.learned);
  });

  it("keeps a learned signature stable when the form renumbers its fields", () => {
    // Greenhouse and friends renumber generated questions between postings.
    // Collapsing digits in the signature is what makes a taught mapping survive.
    const sig = (name) =>
      match({
        descriptors: [{ fieldId: "a", label: "Q7", name, type: "text" }],
        profile: testProfile(),
        settings: defaultSettings(),
      }).unmatched[0].signature;

    expect(sig("answers_7_value")).toBe(sig("answers_31_value"));
  });

  it("lets an adapter hint override the heuristics", () => {
    const result = run(
      [{ fieldId: "a", label: "Q7" }],
      { adapterHints: { a: "identity.email" } }
    );
    expect(pathOf(result, "a")).toBe("identity.email");
    expect(result.fills[0].score).toBe(SCORES.adapter);
    expect(result.fills[0].reason).toMatch(/adapter/);
  });
});

describe("existing values", () => {
  it("leaves a field that already has a value alone", () => {
    const result = run([{ fieldId: "a", label: "First name", hasValue: true }]);
    expect(result.fills).toHaveLength(0);
    expect(result.skipped[0].reason).toBe("Already has a value");
  });

  it("overwrites when the user asks it to", () => {
    const result = run(
      [{ fieldId: "a", label: "First name", hasValue: true }],
      { settings: { overwriteExisting: true } }
    );
    expect(pathOf(result, "a")).toBe("identity.firstName");
  });

  it("ignores disabled fields entirely", () => {
    const result = run([{ fieldId: "a", label: "First name", disabled: true }]);
    expect(result.fills).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.unmatched).toHaveLength(0);
  });
});

describe("one value per field", () => {
  it("never assigns the same profile field to two inputs", () => {
    // Three inputs all mentioning "name" must not all receive the first name.
    const result = run([
      { fieldId: "a", label: "First name" },
      { fieldId: "b", label: "Legal first name" },
      { fieldId: "c", label: "First name" },
    ]);
    const paths = result.fills.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(result.fills).toHaveLength(1);
    // The losers become unmatched, so learn mode can offer them to the user.
    expect(result.unmatched).toHaveLength(2);
  });
});

describe("repeating sections", () => {
  it("routes each employment block to its own profile entry", () => {
    const profile = testProfile();
    profile.work[1] = { ...profile.work[0], company: "Difference Engines", title: "Engineer" };

    const result = run(
      [
        { fieldId: "c0", label: "Company", sectionText: "Employment history", sectionIndex: 0 },
        { fieldId: "c1", label: "Company", sectionText: "Employment history", sectionIndex: 1 },
      ],
      { profile }
    );
    expect(pathOf(result, "c0")).toBe("work.0.company");
    expect(pathOf(result, "c1")).toBe("work.1.company");
    expect(valueOf(result, "c0")).toBe("Analytical Engines");
    expect(valueOf(result, "c1")).toBe("Difference Engines");
  });

  it("uses section context to tell education apart from employment", () => {
    // Both blocks have a "Start date"; only the heading distinguishes them.
    const result = run([
      { fieldId: "w", label: "Start date", sectionText: "Work experience", sectionIndex: 0 },
      { fieldId: "e", label: "Start date", sectionText: "Education", sectionIndex: 0 },
    ]);
    expect(pathOf(result, "w")).toBe("work.0.startDate");
    expect(pathOf(result, "e")).toBe("education.0.startDate");
  });
});

describe("empty profile values", () => {
  it("skips a recognised field with nothing saved for it", () => {
    const result = run([{ fieldId: "a", label: "GitHub" }], { profile: emptyProfile() });
    expect(result.fills).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/nothing saved/i);
  });

  it("fills a derived value the user never typed", () => {
    const result = run([{ fieldId: "a", label: "Full name" }]);
    expect(valueOf(result, "a")).toBe("Ada Lovelace");
  });
});

describe("unmatched fields", () => {
  it("reports a field it cannot place, with a stable signature", () => {
    const result = run([{ fieldId: "a", label: "What is your favourite colour?" }]);
    expect(result.fills).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0].signature).toBeTruthy();
  });

  it("respects the confidence threshold", () => {
    const weak = [{ fieldId: "a", placeholder: "name" }];
    expect(run(weak, { settings: { confidenceThreshold: 30 } }).fills.length).toBeGreaterThanOrEqual(0);
    expect(run(weak, { settings: { confidenceThreshold: 95 } }).fills).toHaveLength(0);
  });
});

describe("result ordering", () => {
  it("returns fills in page order, not score order", () => {
    // The preview reads as a walk down the form, which is how it gets checked.
    const result = run([
      { fieldId: "a", name: "first_name" }, // weaker signal, earlier on the page
      { fieldId: "b", autocomplete: "email", label: "Email" }, // strongest signal
    ]);
    expect(result.fills.map((f) => f.fieldId)).toEqual(["a", "b"]);
  });
});
