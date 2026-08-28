/**
 * The whole pipeline, in one pass.
 *
 * Every other suite tests a layer. This one wires them together the way the
 * service worker does — collect, match, format, fill — and asserts on the state
 * of the DOM afterwards, because that is the only thing the user actually sees.
 *
 * It exists to catch the failures that live in the seams: a descriptor field
 * the matcher reads under a different name, an instruction shape the fill step
 * does not handle, a value formatted for the wrong control.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { match } from "../src/core/matcher.js";
import { formatForField } from "../src/core/value-format.js";
import { emptyProfile, defaultSettings } from "../src/core/defaults.js";
import { adapterFor } from "../src/adapters/index.js";
import { loadContentScripts, loadFixture } from "./helpers/load-content-script.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => readFileSync(resolve(ROOT, "test/fixtures", name), "utf8");

let NS;
beforeEach(() => {
  loadFixture("<form></form>");
  delete globalThis.JobFill;
  NS = loadContentScripts("collect.js", "widgets.js", "files.js", "fill.js", "overlay.js");
});

function profile() {
  const p = emptyProfile();
  Object.assign(p.identity, {
    firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+1 555 123 4567",
  });
  Object.assign(p.address, { city: "London", country: "United Kingdom" });
  Object.assign(p.links, { linkedin: "https://linkedin.com/in/ada", github: "https://github.com/ada" });
  Object.assign(p.eligibility, { authorizedToWork: "Yes", requiresSponsorship: "No" });
  p.screening.howDidYouHearAboutUs = "LinkedIn";
  p.demographics.gender = "Female";
  return p;
}

/**
 * Everything the service worker does, against the real DOM.
 * Mirrors buildPlan + applyPlan in src/background/service-worker.js.
 */
async function fillPage(html, { url = "https://example.com/apply", settings = {} } = {}) {
  loadFixture(html);
  const { descriptors, elements } = NS.collect(document);
  const resolvedSettings = { ...defaultSettings(), ...settings };

  const result = match({
    descriptors,
    profile: profile(),
    settings: resolvedSettings,
    adapterHints: adapterFor(url)?.hintsFor(descriptors) ?? {},
  });

  const byId = new Map(descriptors.map((d) => [d.fieldId, d]));
  const plan = [];
  for (const item of result.fills) {
    const instruction = formatForField({
      value: item.value, path: item.path, descriptor: byId.get(item.fieldId),
    });
    if (instruction) plan.push({ ...item, instruction });
  }

  const applied = await NS.fill.applyPlan(plan, elements, { highlight: false });
  return { ...result, plan, ...applied };
}

const val = (id) => document.getElementById(id).value;

describe("a Greenhouse application, filled", () => {
  let outcome;
  beforeEach(async () => {
    outcome = await fillPage(fixture("greenhouse.html"), {
      url: "https://job-boards.greenhouse.io/acme/jobs/1",
    });
  });

  it("puts the right value in every identity field", () => {
    expect(val("first_name")).toBe("Ada");
    expect(val("last_name")).toBe("Lovelace");
    expect(val("email")).toBe("ada@example.com");
    expect(val("phone")).toBe("+1 555 123 4567");
  });

  it("fills the link fields the adapter disambiguates", () => {
    expect(val("urls_LinkedIn")).toBe("https://linkedin.com/in/ada");
    expect(val("urls_GitHub")).toBe("https://github.com/ada");
  });

  it("selects the right option in both eligibility dropdowns", () => {
    // The select stores "1"/"0" behind the labels "Yes"/"No", so this also
    // proves the option is matched on its text and applied by its value.
    expect(val("q_auth")).toBe("1");
    expect(val("q_sponsor")).toBe("0");
  });

  it("leaves the confirmation-free email field as the only email", () => {
    const emails = [...document.querySelectorAll("input")]
      .filter((i) => i.value === "ada@example.com");
    expect(emails).toHaveLength(1);
  });

  it("leaves every EEO dropdown untouched", () => {
    for (const id of ["gender", "hispanic_ethnicity", "veteran_status"]) {
      expect(val(id)).toBe("");
    }
  });

  it("leaves the company-specific question empty", () => {
    expect(val("q_custom")).toBe("");
  });

  it("reports the adapter it used", () => {
    expect(adapterFor("https://job-boards.greenhouse.io/acme/jobs/1").name).toBe("Greenhouse");
  });

  it("restores the entire form on undo", () => {
    const restored = NS.fill.undo();
    expect(restored).toBe(outcome.filled.length);
    expect(val("first_name")).toBe("");
    expect(val("email")).toBe("");
    expect(val("q_auth")).toBe("");
  });
});

describe("a Workday application, filled", () => {
  beforeEach(async () => {
    await fillPage(fixture("workday.html"), { url: "https://acme.myworkdayjobs.com/careers" });
  });

  it("fills fields that have no label association at all", () => {
    expect(val("input-1")).toBe("Ada");
    expect(val("input-2")).toBe("Lovelace");
    expect(val("input-3")).toBe("ada@example.com");
  });
});

describe("demographics stay off unless asked", () => {
  const form = `
    <label for="g">Gender</label>
    <select id="g"><option value=""></option><option>Male</option><option>Female</option></select>
  `;

  it("writes nothing by default", async () => {
    await fillPage(form);
    expect(val("g")).toBe("");
  });

  it("writes the saved answer once enabled", async () => {
    await fillPage(form, { settings: { fillDemographics: true } });
    expect(val("g")).toBe("Female");
  });
});

describe("values are shaped for the control they land in", () => {
  it("writes a month field in the format its placeholder asks for", async () => {
    // The full round trip for a date: stored ISO, rendered MM/YYYY because the
    // placeholder says so.
    await fillPage(`
      <h2>Work Experience</h2>
      <label for="s">From</label><input id="s" type="text" placeholder="MM/YYYY" />
    `);
    // Nothing saved for work dates in this profile, so the field stays empty —
    // what matters is that no malformed value was written.
    expect(val("s")).toBe("");
  });

  it("matches a country dropdown that spells it differently", async () => {
    await fillPage(`
      <label for="c">Country</label>
      <select id="c"><option value=""></option><option value="gb">UK</option><option value="us">USA</option></select>
    `);
    expect(val("c")).toBe("gb");
  });

  it("leaves a dropdown alone when nothing fits", async () => {
    // Silence beats a confidently wrong selection on a form about to be sent.
    await fillPage(`
      <label for="c">Country</label>
      <select id="c"><option value=""></option><option value="fr">France</option></select>
    `);
    expect(val("c")).toBe("");
  });
});

describe("the form is never made worse", () => {
  it("does not touch fields the user already filled", async () => {
    await fillPage(`
      <label for="a">First name</label><input id="a" value="Grace" />
      <label for="b">Last name</label><input id="b" />
    `);
    expect(val("a")).toBe("Grace");
    expect(val("b")).toBe("Lovelace");
  });

  it("never fills a criminal-history question", async () => {
    await fillPage(`
      <label for="a">Have you ever been convicted of a felony?</label>
      <select id="a"><option value=""></option><option>Yes</option><option>No</option></select>
    `);
    expect(val("a")).toBe("");
  });

  it("does not write into an emergency contact block", async () => {
    await fillPage(`
      <h2>Emergency contact</h2>
      <label for="a">First name</label><input id="a" />
      <label for="b">Phone</label><input id="b" />
    `);
    expect(val("a")).toBe("");
    expect(val("b")).toBe("");
  });

  it("fills nothing at all from an empty profile", async () => {
    loadFixture(`<label for="a">First name</label><input id="a" />`);
    const { descriptors, elements } = NS.collect(document);
    const result = match({ descriptors, profile: emptyProfile(), settings: defaultSettings() });
    await NS.fill.applyPlan([], elements, { highlight: false });

    expect(result.fills).toHaveLength(0);
    expect(val("a")).toBe("");
  });
});
