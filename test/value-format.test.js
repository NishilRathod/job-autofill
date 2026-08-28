/**
 * Value coercion.
 *
 * Knowing which field to fill is only half the job. These tests cover the other
 * half: producing something the control will actually accept. The failures that
 * matter are silent ones — a date that lands off by months because the form
 * wanted DD/MM, or a dropdown that selects the wrong option confidently.
 */

import { describe, it, expect } from "vitest";
import {
  toBoolean, today, formatDate, formatPhone, formatNumber, matchOption, formatForField,
} from "../src/core/value-format.js";

describe("toBoolean", () => {
  it.each([["Yes", true], ["yes", true], ["TRUE", true], ["I am", true], ["Agree", true],
           ["No", false], ["false", false], ["I am not", false], ["Decline", false]])(
    "reads %s as %s", (input, expected) => expect(toBoolean(input)).toBe(expected)
  );

  it("passes booleans through", () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
  });

  it("returns null for anything it cannot interpret", () => {
    // Crucial: an unanswered question must stay unanswered rather than
    // silently becoming "No".
    expect(toBoolean("")).toBeNull();
    expect(toBoolean("Maybe")).toBeNull();
    expect(toBoolean(null)).toBeNull();
  });
});

describe("formatDate", () => {
  it("fills a native date input in ISO", () => {
    expect(formatDate("2020-03-15", { type: "date" })).toBe("2020-03-15");
    expect(formatDate("2020-03", { type: "date" })).toBe("2020-03-01");
  });

  it("fills a native month input", () => {
    expect(formatDate("2020-03-15", { type: "month" })).toBe("2020-03");
  });

  it.each([
    ["DD/MM/YYYY", "15/03/2020"],
    ["MM/DD/YYYY", "03/15/2020"],
    ["MM/YYYY", "03/2020"],
    ["YYYY", "2020"],
  ])("follows a %s placeholder on a text field", (placeholder, expected) => {
    expect(formatDate("2020-03-15", { type: "text", placeholder })).toBe(expected);
  });

  it("reads a maxlength as a format hint", () => {
    // A four-character limit can only be a year.
    expect(formatDate("2020-03-15", { type: "text", maxLength: 4 })).toBe("2020");
    expect(formatDate("2020-03-15", { type: "text", maxLength: 7 })).toBe("2020-03");
  });

  it("falls back to ISO when the format is unknowable", () => {
    // ISO is the safest guess: it is either accepted or visibly rejected,
    // rather than quietly misread as a different date.
    expect(formatDate("2020-03-15", { type: "text" })).toBe("2020-03-15");
  });

  it("accepts a bare year", () => {
    expect(formatDate("2020", { type: "month" })).toBe("2020-01");
  });

  it("returns empty for something that is not a date", () => {
    expect(formatDate("sometime", { type: "date" })).toBe("");
    expect(formatDate("", { type: "date" })).toBe("");
  });
});

describe("today", () => {
  it("renders in ISO", () => {
    expect(today(new Date(2026, 7, 28))).toBe("2026-08-28");
  });

  it("pads single-digit months and days", () => {
    expect(today(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("formatPhone", () => {
  it("keeps the stored formatting when nothing forbids it", () => {
    expect(formatPhone("+1 555 123 4567", {})).toBe("+1 555 123 4567");
  });

  it("strips to digits when the field's pattern demands them", () => {
    expect(formatPhone("+1 (555) 123-4567", { pattern: "\\d{10}" })).toBe("15551234567");
    expect(formatPhone("+1 (555) 123-4567", { pattern: "[0-9]{10}" })).toBe("15551234567");
  });

  it("strips punctuation to fit a maxlength", () => {
    expect(formatPhone("+1 (555) 123-4567", { maxLength: 11 })).toBe("15551234567");
  });

  it("drops the country code when even the digits are too long", () => {
    // Keeping the significant digits beats truncating from the front, which
    // would leave a number that is wrong rather than merely local.
    expect(formatPhone("+1 (555) 123-4567", { maxLength: 10 })).toBe("5551234567");
  });

  it("returns empty for nothing", () => {
    expect(formatPhone("", {})).toBe("");
  });
});

describe("formatNumber", () => {
  it.each([["120000", "120000"], ["$120,000", "120000"], ["120,000.50", "120000.50"], ["abc", ""], ["-", ""]])(
    "%s -> %s", (input, expected) => expect(formatNumber(input)).toBe(expected)
  );
});

describe("matchOption", () => {
  it("matches an option exactly", () => {
    expect(matchOption("Yes", ["Yes", "No"])).toBe("Yes");
  });

  it("ignores case and punctuation", () => {
    expect(matchOption("bachelor's degree", ["Bachelors Degree", "Masters Degree"])).toBe("Bachelors Degree");
  });

  it("matches a country through its aliases", () => {
    const options = ["USA", "United Kingdom", "Canada"];
    expect(matchOption("United States", options, { path: "address.country" })).toBe("USA");
  });

  it("matches a country the other way round", () => {
    const options = ["United States of America", "Canada"];
    expect(matchOption("US", options, { path: "address.country" })).toBe("United States of America");
  });

  it("matches a state by abbreviation", () => {
    expect(matchOption("California", ["CA", "NY", "TX"], { path: "address.stateProvince" })).toBe("CA");
    expect(matchOption("CA", ["California", "New York"], { path: "address.stateProvince" })).toBe("California");
  });

  it("maps yes and no onto a form's own phrasing", () => {
    expect(matchOption("Yes", ["I am authorized", "I am not authorized"])).toBe("I am authorized");
  });

  it("does not confuse a negative option for an affirmative one", () => {
    // "I am not" starts with "I am"; testing longest-first is what prevents
    // a No from selecting Yes.
    expect(matchOption("No", ["I am", "I am not"])).toBe("I am not");
  });

  it("does not match No to Not applicable", () => {
    const chosen = matchOption("No", ["Not applicable to my situation", "Definitely"]);
    expect(chosen).not.toBe("Not applicable to my situation");
  });

  it("tries each entry of a multi-value answer", () => {
    expect(matchOption(["Asian", "White"], ["White", "Black or African American"])).toBe("White");
  });

  it("returns null rather than guessing", () => {
    // Leaving a dropdown alone is always better than selecting the wrong entry.
    expect(matchOption("Purple", ["Red", "Green", "Blue"])).toBeNull();
    expect(matchOption("Yes", [])).toBeNull();
    expect(matchOption("", ["Yes"])).toBeNull();
  });
});

describe("formatForField", () => {
  const field = (descriptor) => ({ descriptor: { tag: "input", type: "text", ...descriptor } });

  it("formats plain text", () => {
    expect(formatForField({ value: "Ada", path: "identity.firstName", ...field({}) }))
      .toEqual({ kind: "text", value: "Ada" });
  });

  it("resolves the signature date at fill time", () => {
    // Stored as an instruction, not a date, so it is always the day the form
    // is actually filled.
    const result = formatForField({
      value: "Today's date", path: "signature.signatureDate", ...field({ type: "date" }),
    });
    expect(result.value).toBe(today());
  });

  it("honours a signature date set to leave blank", () => {
    expect(formatForField({
      value: "Leave blank", path: "signature.signatureDate", ...field({ type: "date" }),
    })).toBeNull();
  });

  it("selects an option for a dropdown", () => {
    const result = formatForField({
      value: "United States",
      path: "address.country",
      descriptor: { tag: "select", type: "select-one", options: ["USA", "Canada"] },
    });
    expect(result).toEqual({ kind: "option", value: "USA" });
  });

  it("leaves a dropdown alone when no option fits", () => {
    expect(formatForField({
      value: "Atlantis",
      path: "address.country",
      descriptor: { tag: "select", options: ["USA", "Canada"] },
    })).toBeNull();
  });

  it("resolves a radio group to one of its options", () => {
    const result = formatForField({
      value: "No",
      path: "eligibility.requiresSponsorship",
      descriptor: { tag: "input", type: "radio", options: ["Yes", "No"] },
    });
    expect(result).toEqual({ kind: "option", value: "No" });
  });

  it("resolves a bare checkbox to a boolean", () => {
    expect(formatForField({
      value: true, path: "work.0.currentlyWorking", ...field({ type: "checkbox" }),
    })).toEqual({ kind: "boolean", value: true });
  });

  it("joins a tag list into comma-separated text", () => {
    expect(formatForField({
      value: ["JavaScript", "Python"], path: "skills.skills", ...field({ type: "textarea", tag: "textarea" }),
    })).toEqual({ kind: "text", value: "JavaScript, Python" });
  });

  it("truncates to a maxlength instead of letting the browser do it", () => {
    const result = formatForField({
      value: "abcdefghij", path: "skills.summary", ...field({ maxLength: 5 }),
    });
    expect(result.value).toBe("abcde");
  });

  it("formats a date field found by its path, not just its input type", () => {
    // Many forms use a plain text input for a graduation date.
    const result = formatForField({
      value: "2018-06-01",
      path: "education.0.endDate",
      ...field({ type: "text", placeholder: "MM/YYYY" }),
    });
    expect(result.value).toBe("06/2018");
  });

  it("returns null for an empty value rather than clearing the field", () => {
    expect(formatForField({ value: "", path: "identity.firstName", ...field({}) })).toBeNull();
    expect(formatForField({ value: [], path: "skills.skills", ...field({}) })).toBeNull();
  });

  it("passes a file field through as an instruction to attach", () => {
    expect(formatForField({
      value: { name: "resume.pdf" }, path: "documents.resume", ...field({ type: "file" }),
    })).toEqual({ kind: "file", value: "documents.resume" });
  });
});
