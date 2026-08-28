/**
 * Derived values.
 *
 * The rule these tests protect: a derivation only ever fills a gap. An explicit
 * value always wins, because the derivation cannot know that someone publishes
 * under a different name than the one on their passport.
 */

import { describe, it, expect } from "vitest";
import { derive, isDerived, resolveValue } from "../src/core/derive.js";
import { emptyProfile } from "../src/core/defaults.js";

/** A profile with the given values merged over a blank one. */
function profileWith(overrides) {
  const profile = emptyProfile();
  for (const [section, values] of Object.entries(overrides)) {
    Object.assign(profile[section], values);
  }
  return profile;
}

describe("isDerived", () => {
  it("knows which paths are computed", () => {
    expect(isDerived("identity.fullName")).toBe(true);
    expect(isDerived("address.currentLocationText")).toBe(true);
    expect(isDerived("signature.signatureFullName")).toBe(true);
    expect(isDerived("identity.firstName")).toBe(false);
  });
});

describe("identity.fullName", () => {
  it("joins first and last", () => {
    expect(derive("identity.fullName", profileWith({ identity: { firstName: "Ada", lastName: "Lovelace" } })))
      .toBe("Ada Lovelace");
  });

  it("includes a middle name when there is one", () => {
    // Forms asking for a full name usually want the legal name, which is what
    // has to match identity documents at background-check time.
    expect(derive("identity.fullName", profileWith({
      identity: { firstName: "Ada", middleName: "Byron", lastName: "Lovelace" },
    }))).toBe("Ada Byron Lovelace");
  });

  it("does not leave a double space when the middle name is blank", () => {
    expect(derive("identity.fullName", profileWith({
      identity: { firstName: "Ada", middleName: "   ", lastName: "Lovelace" },
    }))).toBe("Ada Lovelace");
  });

  it("returns an empty string when there is nothing to join", () => {
    expect(derive("identity.fullName", emptyProfile())).toBe("");
  });

  it("copes with a partly filled name", () => {
    expect(derive("identity.fullName", profileWith({ identity: { firstName: "Ada" } }))).toBe("Ada");
  });
});

describe("address.currentLocationText", () => {
  it("joins city, state and country with commas", () => {
    expect(derive("address.currentLocationText", profileWith({
      address: { city: "Toronto", stateProvince: "Ontario", country: "Canada" },
    }))).toBe("Toronto, Ontario, Canada");
  });

  it("skips the parts that are missing", () => {
    expect(derive("address.currentLocationText", profileWith({
      address: { city: "Berlin", country: "Germany" },
    }))).toBe("Berlin, Germany");
  });
});

describe("signature.signatureFullName", () => {
  it("follows an explicit full name", () => {
    expect(derive("signature.signatureFullName", profileWith({
      identity: { firstName: "Ada", lastName: "Lovelace", fullName: "A. A. Lovelace" },
    }))).toBe("A. A. Lovelace");
  });

  it("falls back to the derived full name", () => {
    expect(derive("signature.signatureFullName", profileWith({
      identity: { firstName: "Ada", lastName: "Lovelace" },
    }))).toBe("Ada Lovelace");
  });
});

describe("resolveValue", () => {
  it("prefers what the user typed over the derivation", () => {
    const profile = profileWith({
      identity: { firstName: "Ada", lastName: "Lovelace", fullName: "Countess Lovelace" },
    });
    expect(resolveValue("identity.fullName", profile)).toBe("Countess Lovelace");
  });

  it("derives when the field is blank", () => {
    const profile = profileWith({ identity: { firstName: "Ada", lastName: "Lovelace" } });
    expect(resolveValue("identity.fullName", profile)).toBe("Ada Lovelace");
  });

  it("treats whitespace as blank", () => {
    const profile = profileWith({ identity: { firstName: "Ada", lastName: "Lovelace", fullName: "  " } });
    expect(resolveValue("identity.fullName", profile)).toBe("Ada Lovelace");
  });

  it("returns ordinary fields untouched", () => {
    const profile = profileWith({ identity: { email: "ada@example.com" } });
    expect(resolveValue("identity.email", profile)).toBe("ada@example.com");
  });

  it("reads into a repeating section by index", () => {
    const profile = emptyProfile();
    profile.work = [{ company: "First" }, { company: "Second" }];
    expect(resolveValue("work.1.company", profile)).toBe("Second");
  });

  it("returns an empty string rather than throwing on a missing path", () => {
    expect(resolveValue("work.9.company", emptyProfile())).toBe("");
    expect(resolveValue("nope.nothing", emptyProfile())).toBe("");
  });

  it("leaves arrays and booleans alone", () => {
    const profile = emptyProfile();
    profile.skills.skills = ["JavaScript"];
    expect(resolveValue("skills.skills", profile)).toEqual(["JavaScript"]);
    expect(resolveValue("work.0.currentlyWorking", profile)).toBe(false);
  });
});
