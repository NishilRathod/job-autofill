/**
 * Country and state lookup.
 *
 * These matter because application forms present the same country in a dozen
 * spellings. If findRegion fails, a `<select>` for country silently goes
 * unfilled — a failure mode that is easy to miss by eye on a long form.
 */

import { describe, it, expect } from "vitest";
import { COUNTRIES, US_STATES, CA_PROVINCES, findRegion } from "../src/core/data/regions.js";

describe("country list", () => {
  it("covers the full ISO 3166-1 set", () => {
    expect(COUNTRIES.length).toBeGreaterThan(240);
  });

  it("gives every country a code, a name and at least one alias", () => {
    for (const country of COUNTRIES) {
      expect(country.code).toMatch(/^[A-Z]{2}$/);
      expect(country.name).toBeTruthy();
      expect(country.aliases.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate codes", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("does not repeat an alias within one country", () => {
    // "USA" is both the alpha-3 code and a hand-typed spelling, so the two
    // source tables overlap and must be deduped.
    for (const country of COUNTRIES) {
      expect(new Set(country.aliases).size, `${country.code} has duplicate aliases`)
        .toBe(country.aliases.length);
    }
  });

  it("sorts by display name", () => {
    const names = COUNTRIES.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });
});

describe("findRegion", () => {
  it.each([
    ["United States", "US"],
    ["united states", "US"],
    ["UNITED STATES OF AMERICA", "US"],
    ["USA", "US"],
    ["U.S.A.", "US"],
    ["U.S.", "US"],
    ["us", "US"],
    ["United Kingdom", "GB"],
    ["UK", "GB"],
    ["GBR", "GB"],
    ["Great Britain", "GB"],
    ["England", "GB"],
    ["India", "IN"],
    ["IND", "IN"],
    ["Viet Nam", "VN"],
    ["Vietnam", "VN"],
    ["South Korea", "KR"],
    ["Korea, Republic of", "KR"],
    ["Czech Republic", "CZ"],
    ["Czechia", "CZ"],
    ["UAE", "AE"],
    ["The Netherlands", "NL"],
  ])("matches %s to %s", (input, code) => {
    expect(findRegion(input)?.code).toBe(code);
  });

  it("returns undefined for input it does not recognise", () => {
    expect(findRegion("Atlantis")).toBeUndefined();
    expect(findRegion("")).toBeUndefined();
    expect(findRegion(null)).toBeUndefined();
    expect(findRegion("   ")).toBeUndefined();
  });

  it("searches whichever list it is given", () => {
    // "CA" is California in the state list and Canada in the country list. The
    // caller picking the list is what disambiguates.
    expect(findRegion("CA", US_STATES).name).toBe("California");
    expect(findRegion("CA").name).toBe("Canada");
  });
});

describe("state and province lists", () => {
  it("includes all fifty US states plus DC and territories", () => {
    expect(US_STATES.length).toBe(55);
    expect(findRegion("District of Columbia", US_STATES)?.code).toBe("DC");
    expect(findRegion("Puerto Rico", US_STATES)?.code).toBe("PR");
  });

  it("includes all thirteen Canadian provinces and territories", () => {
    expect(CA_PROVINCES.length).toBe(13);
    expect(findRegion("ON", CA_PROVINCES)?.name).toBe("Ontario");
    expect(findRegion("Newfoundland and Labrador", CA_PROVINCES)?.code).toBe("NL");
  });

  it("matches state names case- and punctuation-insensitively", () => {
    expect(findRegion("new york", US_STATES)?.code).toBe("NY");
    expect(findRegion("U.S. Virgin Islands", US_STATES)?.code).toBe("VI");
  });
});
