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
import { adapterFor } from "../src/adapters/index.js";
import { signatureOf } from "../src/core/normalize.js";
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
  Object.assign(profile.preferences, {
    currentSalary: "5000", desiredSalary: "7000",
    noticePeriod: "30 days", earliestStartDate: "2026-11-01",
  });
  profile.identity.fullName = "Ada Lovelace";
  profile.address.stateProvince = "Greater London";
  profile.address.currentLocationText = "London, United Kingdom";
  profile.screening.howDidYouHearAboutUs = "LinkedIn";
  profile.screening.previouslyEmployedHere = "No";
  profile.demographics.gender = "Female";
  // Document slots hold metadata; the blob itself lives in IndexedDB.
  profile.documents.resume = { name: "ada-lovelace-cv.pdf", size: 240000, type: "application/pdf", savedAt: new Date().toISOString() };
  return profile;
}

/**
 * Collect a fixture and run the matcher over it.
 *
 * Pass a `url` to exercise the site adapter as well. Without one this is the
 * generic engine alone, which is what most of these cases want to prove.
 */
function planFor(html, { profile = fullProfile(), settings = {}, url } = {}) {
  loadFixture(html);
  const { descriptors } = loadContentScripts("collect.js").collect(document);
  const adapter = url ? adapterFor(url) : null;
  return {
    descriptors,
    adapter,
    ...match({
      descriptors,
      profile,
      settings: { ...defaultSettings(), ...settings },
      adapterHints: adapter?.hintsFor(descriptors) ?? {},
    }),
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

describe("Lever-style form with unnamed custom questions", () => {
  let result;
  beforeEach(() => {
    result = planFor(fixture("lever.html"), { url: "https://jobs.lever.co/acme/1234/apply" });
  });

  const byLabel = (text) => result.descriptors.find((d) => d.label === text);
  const fillFor = (descriptor) => result.fills.find((f) => f.fieldId === descriptor?.fieldId);

  it("reads a question that lives in a sibling div two levels up", () => {
    // No `for`, no aria, and the control is wrapped twice before the label's
    // level is reached. This is the shape of every Lever custom question.
    expect(byLabel("Current Monthly Salary/Compensation (USD)")).toBeDefined();
    expect(byLabel("What is your earliest start date?")).toBeDefined();
  });

  it("keeps a question that runs past the prose cut-off", () => {
    // 127 characters. Treated as prose it is discarded and the field arrives
    // unlabelled, which on Lever means it arrives with no signal at all.
    const long = result.descriptors.find((d) => d.label.startsWith("Wing Assistants are enrolled"));
    expect(long).toBeDefined();
    expect(long.label.length).toBeGreaterThan(120);
  });

  it("labels a radio group with its question, not with its first answer", () => {
    // Each option is wrapped in its own <label>, so reading the option's label
    // answers "Yes" to every question on the form.
    const group = result.descriptors.filter((d) => d.type === "radio");
    expect(group.map((d) => d.label)).not.toContain("Yes");
    expect(byLabel("Have you worked for this company before?")).toBeDefined();
  });

  it("collapses a checkbox group into one question with every answer", () => {
    const industries = byLabel("Which industries have you worked in? (Select all that apply.)");
    expect(industries).toBeDefined();
    expect(industries.options).toHaveLength(6);
    expect(industries.options).toContain("Healthcare");
  });

  it("leaves a lone consent tickbox as a field of its own", () => {
    // Only a group of checkboxes sharing a name is one question. Folding a
    // standalone one into a group would lose it entirely.
    const checkboxes = result.descriptors.filter((d) => d.type === "checkbox");
    expect(checkboxes).toHaveLength(2);
  });

  it.each([
    ["Full name", "identity.fullName"],
    ["Email", "identity.email"],
    ["Current location", "address.currentLocationText"],
    ["Current company", "work.0.company"],
    ["Current Monthly Salary/Compensation (USD)", "preferences.currentSalary"],
    ["Expected Monthly Salary/Compensation (USD)", "preferences.desiredSalary"],
    ["How did you hear about this job?", "screening.howDidYouHearAboutUs"],
  ])("places %s in %s", (label, path) => {
    expect(fillFor(byLabel(label))?.path).toBe(path);
  });

  it("resolves an adapter hint for a repeating field to a real profile slot", () => {
    // The adapter names "work.company"; the profile stores an array. Left
    // unresolved the lookup finds nothing and the field is reported as having
    // no saved value, with the value sitting right there.
    const fill = fillFor(byLabel("Current company"));
    expect(fill?.path).toBe("work.0.company");
    expect(fill?.value).toBe("Analytical Engines");
  });

  it("does not read an employer name out of a yes/no question", () => {
    // "Have you worked for this company before?" contains the word "company",
    // which is enough for the employer rule to claim it once the question is
    // read correctly at all.
    const fill = fillFor(byLabel("Have you worked for this company before?"));
    expect(fill?.path).toBe("screening.previouslyEmployedHere");
    expect(fill?.value).toBe("No");
  });
});

describe("Zoho Recruit form built from Lyte components", () => {
  let result;
  beforeEach(() => {
    result = planFor(fixture("zoho-recruit.html"), {
      url: "https://acme.zohorecruit.in/jobs/Careers/1/Engineer",
    });
  });

  const byLabel = (text) => result.descriptors.filter((d) => d.label === text);
  const fillFor = (descriptor) => result.fills.find((f) => f.fieldId === descriptor?.fieldId);

  it("ignores a currency symbol sitting nearer than the real label", () => {
    // `label.lyteLabel` holds "₹" and is two levels closer to the input than
    // `label.crm-from-label`. Taking the nearest names both salary fields "₹",
    // which also collapses their signatures so teaching one teaches both.
    const labels = result.descriptors.map((d) => d.label);
    expect(labels).not.toContain("₹");
    expect(labels).toContain("Current Salary");
    expect(labels).toContain("Expected Salary");
  });

  it("gives the two salary fields distinct signatures", () => {
    const salaries = result.descriptors.filter((d) => /Salary$/.test(d.label));
    expect(salaries).toHaveLength(2);
    const signatures = new Set(salaries.map((d) => signatureOf(d)));
    expect(signatures.size).toBe(2);
  });

  it("reaches a label six wrappers above the input", () => {
    // The dial-code dropdown adds a level that pushes the phone field past a
    // shorter ancestor limit, and it is the field users most notice missing.
    expect(byLabel("Mobile").length).toBeGreaterThan(0);
  });

  it("prefers the text box over the dropdown that shares its label", () => {
    // One <label>First Name</label> covers a salutation dropdown and the real
    // name box. Both score an exact match; document order favours the dropdown.
    const [dropdown, input] = byLabel("First Name");
    expect(dropdown.type).toBe("combobox");
    expect(input.type).toBe("text");
    expect(fillFor(input)?.path).toBe("identity.firstName");
    expect(fillFor(dropdown)).toBeUndefined();
  });

  it("does not bind a label through an id four controls share", () => {
    // Four typeahead inputs all carry id="inputId". A label[for] lookup against
    // that id binds an arbitrary one of them to somebody else's question.
    expect(byLabel("City").length).toBeGreaterThan(0);
    expect(byLabel("State/Province").length).toBeGreaterThan(0);
  });

  it.each([
    ["Last Name", "identity.lastName"],
    ["Email", "identity.email"],
    ["Mobile", "identity.phone"],
    ["Current Salary", "preferences.currentSalary"],
    ["Expected Salary", "preferences.desiredSalary"],
    ["Notice Period", "preferences.noticePeriod"],
    ["Resume", "documents.resume"],
  ])("places %s in %s", (label, path) => {
    const filled = byLabel(label).map((d) => fillFor(d)?.path).filter(Boolean);
    expect(filled).toContain(path);
  });

  it("leaves the resume-parsing uploader alone", () => {
    // Attaching there feeds Zoho's own parser rather than filling the required
    // Resume field, which would look like success and submit without a resume.
    const parser = result.descriptors.find((d) => d.name === "rec-easyresume_file");
    expect(fillFor(parser)).toBeUndefined();
  });
});

describe("Workday fields named only by their wrapper", () => {
  it("places a field whose control carries no meaningful attribute", () => {
    // How Workday is really built: a generic `textInputBox` on the input, the
    // specific `formField-addressSection--city` on the div around it, and a
    // localised label that the heuristics cannot read. An adapter matching only
    // the control's own attributes passes a simplified fixture and then places
    // nothing at all on a live page.
    const result = planFor(fixture("workday.html"), {
      url: "https://acme.wd1.myworkdayjobs.com/en-US/careers/apply",
    });
    const city = result.descriptors.find((d) => d.id === "wd-city");

    expect(city.label).toBe("Ville");
    expect(city.ancestorIds).toContain("formField-addressSection--city");
    expect(result.fills.find((f) => f.fieldId === city.fieldId)?.path).toBe("address.city");
  });

  it("still separates repeated employment blocks", () => {
    // The repeat counter now only counts siblings that carry this same field.
    // A form that puts every question in its own <li> must not read the sixth
    // question as the sixth employment entry.
    const result = planFor(fixture("workday.html"));
    const companies = result.descriptors.filter((d) => d.label === "Company");
    const indexes = companies.map((d) => d.sectionIndex);
    expect(indexes).toEqual([0, 1]);
  });
});

describe("resolving a label out of unhelpful markup", () => {
  const labelsOf = (html) => planFor(html).descriptors.map((d) => ({
    name: d.name, label: d.label, source: d.labelSource,
  }));

  it("prefers a real label further away to decoration close by", () => {
    // Component libraries park a unit or a currency symbol between the label
    // and the input. Nearest-wins names the field after the decoration.
    const [field] = labelsOf(`
      <div class="row">
        <label class="field-label">Expected Salary</label>
        <div class="control"><label class="unit">£</label><input name="q1" /></div>
      </div>
    `);
    expect(field.label).toBe("Expected Salary");
  });

  it("prefers a labelled container to a nearer bare div", () => {
    const [field] = labelsOf(`
      <div class="question">
        <div class="question-label">What is your notice period?</div>
        <div class="control"><div class="hint">in weeks</div><input name="q1" /></div>
      </div>
    `);
    expect(field.label).toBe("What is your notice period?");
  });

  it("still treats a long bare div as prose rather than a label", () => {
    // The relaxed cut-off applies only to something that announces itself as a
    // label. A paragraph of instructions is not one.
    const prose = "x".repeat(200);
    const [field] = labelsOf(`<div><div>${prose}</div><input name="q1" /></div>`);
    expect(field.label).toBe("");
  });

  it("reads a label out of a table row's header cell", () => {
    const [field] = labelsOf(`
      <table><tr><th>Postal code</th><td><input name="q1" /></td></tr></table>
    `);
    expect(field.label).toBe("Postal code");
  });

  it("reads a label out of a column heading when the row has none", () => {
    // The older table-laid-out systems put the question in <thead> and nothing
    // beside the control at all, so no amount of walking up finds it.
    const fields = labelsOf(`
      <table>
        <thead><tr><th>City</th><th>Postal code</th></tr></thead>
        <tbody><tr><td><input name="c" /></td><td><input name="p" /></td></tr></tbody>
      </table>
    `);
    const postal = fields.find((f) => f.name === "p");
    expect(postal.label).toBe("Postal code");
    expect(postal.source).toBe("table-header");
  });

  it("falls back to the title attribute when nothing else names the field", () => {
    const [field] = labelsOf(`<input name="q1" title="GitHub URL" />`);
    expect(field.label).toBe("GitHub URL");
    expect(field.source).toBe("title");
  });

  it("collects a search-typed input rather than mistaking it for page search", () => {
    // On an application form this is the country or skill typeahead, which is
    // one of the fields most in need of help.
    const fields = labelsOf(`
      <div><label class="lbl">Country</label><input type="search" name="country" /></div>
    `);
    expect(fields.map((f) => f.name)).toContain("country");
  });

  it("records the ids of wrapping elements", () => {
    const { descriptors } = planFor(`
      <div data-automation-id="formField-addressSection--city">
        <input name="q1" data-automation-id="textInputBox" />
      </div>
    `);
    expect(descriptors[0].ancestorIds).toContain("formField-addressSection--city");
  });
});

describe("controls dressed up as buttons", () => {
  it("does not read a link's own caption as the field's question", () => {
    // Lever wraps each file input in <a><span class="default-label">Upload
    // file</span><input></a>. That class is label-shaped enough to beat the
    // real question two levels further up, and every upload on the form then
    // arrives called "Upload file".
    const { descriptors } = planFor(`
      <div>
        <div class="application-label"><div class="text">Upload a screenshot of your internet speed</div></div>
        <div class="application-field">
          <a class="upload-file-overlay">
            <span class="filename"></span>
            <span class="default-label">Upload file</span>
            <input type="file" name="q1" />
          </a>
        </div>
      </div>
    `);
    expect(descriptors[0].label).toBe("Upload a screenshot of your internet speed");
  });
});

describe("repeated blocks named only by index", () => {
  it("counts entries when no vendor attribute distinguishes them", () => {
    // test/fixtures/workday.html gives every repeated control a
    // data-automation-id, which repeatKeyFor tries first — so the name fallback
    // it drops to on most other sites was never exercised, and a broken
    // digit-collapsing regex there passed the entire suite.
    const profile = fullProfile();
    profile.education[1] = { ...profile.education[0], school: "Imperial College" };

    const result = planFor(`
      <h2>Education</h2>
      <section class="entry">
        <div><label class="lbl">School</label><input name="education_1_school" /></div>
      </section>
      <section class="entry">
        <div><label class="lbl">School</label><input name="education_2_school" /></div>
      </section>
    `, { profile });

    expect(result.descriptors.map((d) => d.sectionIndex)).toEqual([0, 1]);
    expect(result.fills.map((f) => f.path)).toEqual(["education.0.school", "education.1.school"]);
    expect(result.fills.map((f) => f.value)).toEqual(["University of London", "Imperial College"]);
  });
});
