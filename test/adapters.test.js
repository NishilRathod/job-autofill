/**
 * Per-site adapters.
 *
 * Two distinct risks here, and the second is the one that bites.
 *
 * The obvious risk is an adapter not matching its site. That fails loudly — the
 * popup says "generic match" and the user notices.
 *
 * The real risk is an adapter matching *too much*: a pattern like "email" that
 * also matches "confirm_email", or a URL pattern loose enough to fire on an
 * unrelated site. Adapter hints outrank every heuristic including the vetoes,
 * so an over-broad pattern silently defeats the safety net that stops JobFill
 * putting an address in an emergency contact field.
 */

import { describe, it, expect } from "vitest";
import { adapterFor, adapterNames, compilePattern } from "../src/adapters/index.js";
import { ATS_ADAPTERS } from "../src/adapters/ats.js";
import { FIELD_BY_PATH } from "../src/core/schema.js";

/** Build a descriptor the way the collector would. */
const field = (fieldId, attrs = {}) => ({
  fieldId, name: "", id: "", automationId: "", label: "", ...attrs,
});

describe("adapter registry", () => {
  it("registers every adapter exactly once", () => {
    const names = adapterNames();
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns null for a site with no adapter", () => {
    // The generic engine handles those; a wrong adapter is worse than none.
    expect(adapterFor("https://example.com/careers")).toBeNull();
    expect(adapterFor("")).toBeNull();
    expect(adapterFor(undefined)).toBeNull();
  });
});

describe("adapter definitions", () => {
  it.each(ATS_ADAPTERS.map((a) => [a.name, a]))("%s is well formed", (_name, adapter) => {
    expect(adapter.name).toBeTruthy();
    expect(adapter.match).toBeInstanceOf(RegExp);
    // Either kind of pattern is enough. Zoho Recruit has no usable attribute
    // anywhere on the page and is deliberately questions-only.
    const patterns =
      Object.keys(adapter.selectors ?? {}).length + Object.keys(adapter.questions ?? {}).length;
    expect(patterns).toBeGreaterThan(0);
  });

  it.each(
    ATS_ADAPTERS.flatMap((a) =>
      Object.entries(a.questions ?? {}).map(([pattern, path]) => [`${a.name}: ${pattern}`, path])
    )
  )("%s asks about a real schema field", (_label, path) => {
    // Same silent-failure risk as a selector typo: the hint wins the match,
    // then the value lookup finds nothing and the field is quietly skipped.
    expect(FIELD_BY_PATH.has(path), `${path} is not in the schema`).toBe(true);
  });

  it.each(
    ATS_ADAPTERS.flatMap((a) => Object.keys(a.questions ?? {}).map((p) => [a.name, p]))
  )("%s question pattern %s compiles", (_name, pattern) => {
    expect(() => new RegExp(pattern, "i")).not.toThrow();
  });

  it.each(
    ATS_ADAPTERS.flatMap((a) =>
      Object.entries(a.selectors ?? {}).map(([pattern, path]) => [`${a.name}: ${pattern}`, path])
    )
  )("%s points at a real schema field", (_label, path) => {
    // A typo here fails silently: the hint wins the match, then the value
    // lookup finds nothing and the field is quietly skipped.
    expect(FIELD_BY_PATH.has(path), `${path} is not in the schema`).toBe(true);
  });

  it.each(
    ATS_ADAPTERS.flatMap((a) => Object.keys(a.selectors ?? {}).map((p) => [a.name, p]))
  )("%s pattern %s compiles", (_name, pattern) => {
    expect(() => new RegExp(pattern, "i")).not.toThrow();
  });
});

describe("URL matching", () => {
  it.each([
    ["https://acme.wd1.myworkdayjobs.com/en-US/careers/job/x", "Workday"],
    ["https://job-boards.greenhouse.io/acme/jobs/123", "Greenhouse"],
    ["https://boards.greenhouse.io/acme/jobs/123", "Greenhouse"],
    ["https://jobs.lever.co/acme/abc-123/apply", "Lever"],
    ["https://jobs.ashbyhq.com/acme/abc-123/application", "Ashby"],
    ["https://apply.workable.com/acme/j/ABC123/apply/", "Workable"],
    ["https://jobs.smartrecruiters.com/Acme/744000", "SmartRecruiters"],
    ["https://careers-acme.icims.com/jobs/1234/login", "iCIMS"],
    ["https://acme.taleo.net/careersection/apply.ftl", "Taleo"],
    ["https://acme.bamboohr.com/careers/42", "BambooHR"],
  ])("%s -> %s", (url, expected) => {
    expect(adapterFor(url)?.name).toBe(expected);
  });

  it.each([
    "https://www.linkedin.com/jobs/view/123",
    "https://www.indeed.com/viewjob?jk=abc",
    "https://mybank.example.com/transfer",
    "https://docs.google.com/forms/d/e/abc/viewform",
  ])("does not claim %s", (url) => {
    // An adapter firing on an unrelated site would apply hints that outrank
    // every safety veto.
    expect(adapterFor(url)).toBeNull();
  });
});

describe("hintsFor", () => {
  it("maps Workday's field names, which outlive its visible labels", () => {
    // These are the real names, read off a signed-in My Information step. The
    // meaningful one is on the wrapper; the control itself carries no
    // data-automation-id at all.
    const adapter = adapterFor("https://acme.myworkdayjobs.com/careers");
    const hints = adapter.hintsFor([
      field("a", { name: "legalName--firstName", id: "name--legalName--firstName" }),
      field("b", { name: "legalName--lastName", id: "name--legalName--lastName" }),
      field("c", { name: "postalCode", ancestorIds: ["formField-postalCode"] }),
    ]);
    expect(hints).toEqual({
      a: "identity.firstName",
      b: "identity.lastName",
      c: "address.postalCode",
    });
  });

  it("matches Workday tenants that separate with an underscore", () => {
    // An underscore is a word character, so a pattern built on  matches the
    // "--" tenant and silently fails on the "_" one.
    const adapter = adapterFor("https://acme.myworkdayjobs.com/careers");
    expect(adapter.hintsFor([field("a", { name: "address_city" })])).toEqual({
      a: "address.city",
    });
  });

  it("disambiguates Greenhouse's bracketed URL field names", () => {
    const adapter = adapterFor("https://job-boards.greenhouse.io/acme/jobs/1");
    const hints = adapter.hintsFor([
      field("a", { name: "job_application[urls][LinkedIn]" }),
      field("b", { name: "job_application[urls][GitHub]" }),
    ]);
    expect(hints.a).toBe("links.linkedin");
    expect(hints.b).toBe("links.github");
  });

  it("reads Lever's 'org' as the applicant's employer", () => {
    // The heuristics read "org" as an organisation name with no owner.
    const hints = adapterFor("https://jobs.lever.co/acme").hintsFor([field("a", { name: "org" })]);
    expect(hints.a).toBe("work.company");
  });

  it("leaves fields it has no opinion about to the heuristics", () => {
    const hints = adapterFor("https://job-boards.greenhouse.io/acme/jobs/1").hintsFor([
      field("a", { name: "job_application[first_name]" }),
      field("b", { name: "some_custom_question_42" }),
    ]);
    expect(hints).toEqual({});
  });

  it("returns nothing for a page with no fields", () => {
    expect(adapterFor("https://jobs.lever.co/acme").hintsFor([])).toEqual({});
  });

  it("gives each field at most one hint", () => {
    // Two patterns matching the same field would make the result depend on
    // object key order, which is not something to rely on.
    const hints = adapterFor("https://apply.workable.com/acme").hintsFor([
      field("a", { name: "email", id: "email" }),
    ]);
    expect(Object.values(hints)).toHaveLength(1);
  });
});

describe("patterns are not over-broad", () => {
  it("does not treat Workday's confirm-email field as the email field", () => {
    // Adapter hints outrank the vetoes, so this has to be handled in the
    // pattern itself rather than left to the matcher's safety net.
    const hints = adapterFor("https://acme.myworkdayjobs.com/careers").hintsFor([
      field("a", { automationId: "email" }),
      field("b", { automationId: "confirmEmail" }),
    ]);
    expect(hints.a).toBe("identity.email");
    expect(hints.b).toBeUndefined();
  });

  it("does not treat Workday's state field as the country field", () => {
    // "addressSection_country" is a prefix of "addressSection_countryRegion",
    // which is the state/province field.
    const hints = adapterFor("https://acme.myworkdayjobs.com/careers").hintsFor([
      field("a", { automationId: "addressSection_country" }),
      field("b", { automationId: "addressSection_countryRegion" }),
    ]);
    expect(hints.a).toBe("address.country");
    expect(hints.b).toBe("address.stateProvince");
  });

  it("keeps the phone number out of the other three phone controls", () => {
    // On a live Workday form the number, the device type, the dial code and
    // the extension all carry ids beginning "phoneNumber--". A plain
    // "phoneNumber" pattern claimed every one of them.
    const hints = adapterFor("https://acme.myworkdayjobs.com/careers").hintsFor([
      field("a", { id: "phoneNumber--phoneType", name: "phoneType" }),
      field("b", { id: "phoneNumber--countryPhoneCode" }),
      field("c", { id: "phoneNumber--phoneNumber", name: "phoneNumber" }),
      field("d", { id: "phoneNumber--extension", name: "extension" }),
    ]);
    expect(hints.c).toBe("identity.phone");
    expect(hints.a).toBe("identity.phoneType");
    expect(hints.b).toBeUndefined();
    expect(hints.d).toBeUndefined();
  });

  it("does not treat a local-script name variant as the applicant's name", () => {
    const hints = adapterFor("https://acme.myworkdayjobs.com/careers").hintsFor([
      field("a", { name: "legalName--firstName" }),
      field("b", { name: "legalName--firstNameLocal" }),
    ]);
    expect(hints.a).toBe("identity.firstName");
    expect(hints.b).toBeUndefined();
  });

  it("does not claim a cover letter upload as the resume", () => {
    const hints = adapterFor("https://job-boards.greenhouse.io/acme/jobs/1").hintsFor([
      field("a", { name: "job_application[resume]" }),
      field("b", { name: "job_application[cover_letter]" }),
    ]);
    expect(hints.a).toBe("documents.resume");
    expect(hints.b).toBe("documents.coverLetterFile");
  });
});

describe("question patterns and the safety net", () => {
  const zoho = adapterFor("https://acme.zohorecruit.in/jobs/Careers/1/Engineer");

  it("does not hand somebody else's field to the applicant's own data", () => {
    // A selector names one exact attribute and is hand-verified, so it earns the
    // right to outrank the vetoes. A question matches prose, and prose on an
    // application form is full of near-misses: "Phone (Emergency Contact)"
    // begins with "Phone" exactly as the applicant's own field does.
    const hints = zoho.hintsFor([
      field("f1", { label: "Phone (Emergency Contact)" }),
      field("f2", { label: "Email of Reference" }),
    ]);
    expect(hints).toEqual({});
  });

  it("still matches the questions it is there for", () => {
    const hints = zoho.hintsFor([
      field("f1", { label: "Mobile" }),
      field("f2", { label: "Email" }),
      field("f3", { label: "Current Salary" }),
    ]);
    expect(hints).toEqual({
      f1: "identity.phone",
      f2: "identity.email",
      f3: "preferences.currentSalary",
    });
  });
});

describe("pattern compilation", () => {
  it("reads a word boundary as a separator boundary", () => {
    // `\b` cannot be used literally against form field names: an underscore is
    // a word character, so "\bcity\b" matches "address--city" and
    // "address.city" but silently fails on "address_city". Every \b in ats.js
    // was wrong this way, and the fixtures happened to use bracket- and
    // dot-separated names, so the suite stayed green over it.
    const city = compilePattern("\\bcity\\b");
    expect(city.test("address_city")).toBe(true);
    expect(city.test("address--city")).toBe(true);
    expect(city.test("location.city")).toBe(true);
    expect(city.test("city")).toBe(true);
    // Still a boundary: a fragment of a longer word must not match.
    expect(city.test("addresscity")).toBe(false);
    expect(city.test("cityscape")).toBe(false);
  });

  it("places the boundary correctly on each side of an alternation", () => {
    const org = compilePattern("\\borg\\b|\\borg-input\\b");
    expect(org.test("applicant_org")).toBe(true);
    expect(org.test("org-input")).toBe(true);
    expect(org.test("organisation")).toBe(false);
  });

  it("does not mistake an escaped backslash for a boundary", () => {
    // "\\\\b" is a literal backslash followed by a b, not a word boundary.
    // Nothing in ats.js needs that today, which is exactly why it would go
    // unnoticed if this function got it wrong later.
    const literal = compilePattern("a\\\\bc");
    expect(literal.source).toBe("a\\\\bc");
    expect(literal.test("a\\bc")).toBe(true);
  });

  it("leaves everything other than a boundary alone", () => {
    const resume = compilePattern("job_application\\[resume\\]|\\bresume\\b");
    expect(resume.test("job_application[resume]")).toBe(true);
    expect(resume.test("my_resume")).toBe(true);
    expect(resume.source).toContain("job_application\\[resume\\]");
  });
});

describe("snake_case field names", () => {
  // The convention every one of these adapters was blind to.
  it.each([
    ["https://acme.workable.com/x", "applicant_firstname", "identity.firstName"],
    ["https://acme.workable.com/x", "candidate_email", "identity.email"],
    ["https://acme.workable.com/x", "contact_phone", "identity.phone"],
    ["https://acme.icims.com/x", "base_lastname", "identity.lastName"],
    ["https://jobs.smartrecruiters.com/x", "location_city", "address.city"],
    ["https://acme.bamboohr.com/x", "personal_website", "links.website"],
    ["https://jobs.lever.co/x", "applicant_org", "work.company"],
  ])("%s matches %s", (url, name, path) => {
    const hints = adapterFor(url).hintsFor([field("a", { name })]);
    expect(hints.a).toBe(path);
  });
});

describe("hints yield to a veto", () => {
  // A selector naming one exact attribute on one known site is hand-verified
  // and earns its authority. "email" and "phone" are not that — they are
  // generic heuristics wearing an adapter's badge, and on a long form each has
  // a twin belonging to somebody else.
  it.each([
    ["https://acme.workable.com/x", "confirm_email", "Confirm email"],
    ["https://acme.workable.com/x", "emergency_phone", "Emergency contact phone"],
    ["https://acme.bamboohr.com/x", "reference_email", "Reference email"],
    ["https://acme.bamboohr.com/x", "supervisor_phone", "Supervisor phone"],
    ["https://acme.bamboohr.com/x", "company_website", "Company website"],
  ])("refuses %s named %s", (url, name, label) => {
    const hints = adapterFor(url).hintsFor([field("a", { name, label })]);
    expect(hints.a).toBeUndefined();
  });

  it("still matches the legitimate field beside the twin", () => {
    const hints = adapterFor("https://acme.workable.com/x").hintsFor([
      field("a", { name: "confirm_email", label: "Confirm email" }),
      field("b", { name: "candidate_email", label: "Email" }),
    ]);
    expect(hints.a).toBeUndefined();
    expect(hints.b).toBe("identity.email");
  });

  it("reads the veto off the label, not off the attribute the selector matched", () => {
    // Workday's state/province field is named `countryRegion`, and
    // address.stateProvince vetoes "country" to keep a field labelled
    // "Country / Region" from becoming a state. Reading attribute names here
    // would refuse the very field the selector exists for.
    const hints = adapterFor("https://acme.myworkdayjobs.com/x").hintsFor([
      field("a", { automationId: "addressSection_countryRegion" }),
    ]);
    expect(hints.a).toBe("address.stateProvince");
  });
});
