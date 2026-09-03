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
import { adapterFor, adapterNames } from "../src/adapters/index.js";
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
  it("maps Workday's automation ids, which outlive its visible labels", () => {
    const adapter = adapterFor("https://acme.myworkdayjobs.com/careers");
    const hints = adapter.hintsFor([
      field("a", { automationId: "legalNameSection_firstName" }),
      field("b", { automationId: "legalNameSection_lastName" }),
      field("c", { automationId: "addressSection_postalCode" }),
    ]);
    expect(hints).toEqual({
      a: "identity.firstName",
      b: "identity.lastName",
      c: "address.postalCode",
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
