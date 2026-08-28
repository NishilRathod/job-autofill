/**
 * Boots the options page in jsdom.
 *
 * This is the cheapest way to catch the failure mode that matters most for a
 * page built entirely from generated DOM: a runtime error partway through
 * rendering, which leaves a half-drawn screen and no obvious clue why. Asserting
 * that all 15 sections paint, that a keystroke persists, and that the
 * demographics gate reads correctly covers the wiring between schema, store and
 * UI without needing a browser.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SECTIONS } from "../src/core/schema.js";
import { createFakeStorageArea } from "./helpers/fake-storage.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Let queued microtasks and the 350ms save debounce settle. */
const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/**
 * Load options.html into the document and boot options.js against a fake
 * storage area.
 *
 * options.js self-boots on import and reads `chrome` at module scope, so the
 * shim has to be installed first and the module cache reset between tests.
 */
async function bootPage(area) {
  const html = readFileSync(resolve(ROOT, "src/ui/options/options.html"), "utf8");
  // Drop the module script tag: this test imports options.js itself so it can
  // await the boot, which a <script> tag would not let it do.
  document.documentElement.innerHTML = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/[\s\S]*<head>/, "<head>")
    .replace(/<\/html>/, "");

  globalThis.chrome = { storage: { local: area } };
  // jsdom implements neither, and both are called during a panel switch.
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();

  vi.resetModules();
  await import("../src/ui/options/options.js");
  await settle();
}

describe("options page", () => {
  let area;

  beforeEach(async () => {
    area = createFakeStorageArea();
    await bootPage(area);
  });

  it("boots without throwing and paints the rail", () => {
    const items = document.querySelectorAll(".rail__item");
    // 15 schema sections plus snippets, settings and backup.
    expect(items).toHaveLength(SECTIONS.length + 3);
  });

  it("opens on the first section", () => {
    expect(document.querySelector(".panel__title").textContent).toBe("Identity");
    expect(document.querySelector(".rail__item[aria-current='true']").textContent)
      .toContain("Identity");
  });

  it("renders every field of the active section", () => {
    const identity = SECTIONS.find((s) => s.id === "identity");
    expect(document.querySelectorAll(".panel .field")).toHaveLength(identity.fields.length);
  });

  it("shows the canonical path beside each field", () => {
    // The page's signature detail — if this regresses the design intent is lost.
    const paths = [...document.querySelectorAll(".field__path")].map((n) => n.textContent);
    expect(paths).toContain("identity.firstName");
    expect(paths).toContain("identity.email");
  });

  it("starts at zero coverage on a fresh profile", () => {
    expect(document.querySelector(".rail__pct").textContent).toBe("0%");
  });

  it("persists a typed value and updates coverage", async () => {
    const input = document.getElementById("f-identity-firstName");
    input.value = "Ada";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Coverage is updated from the in-memory mirror immediately...
    expect(document.querySelector(".rail__pct").textContent).not.toBe("0%");

    // ...and the write lands after the debounce.
    await settle(500);
    expect((await area.get(["profile"])).profile.identity.firstName).toBe("Ada");
  });

  it("debounces writes rather than saving on every keystroke", async () => {
    const input = document.getElementById("f-identity-firstName");
    const before = area.writes;

    for (const value of ["A", "Ad", "Ada"]) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await settle(500);

    expect(area.writes - before).toBe(1);
  });

  it("switches panels from the rail", async () => {
    const educationItem = [...document.querySelectorAll(".rail__item")]
      .find((n) => n.textContent.startsWith("Education"));
    educationItem.click();
    await settle();

    expect(document.querySelector(".panel__title").textContent).toBe("Education");
    expect(document.querySelector(".panel__eyebrow").textContent).toBe("education");
  });

  it("renders a repeating section as entry cards with an add button", async () => {
    [...document.querySelectorAll(".rail__item")]
      .find((n) => n.textContent.startsWith("Employment"))
      .click();
    await settle();

    expect(document.querySelectorAll(".panel .card")).toHaveLength(1);
    expect(document.querySelector(".panel__add").textContent).toMatch(/add another position/i);
  });

  it("adds and removes entries in a repeating section", async () => {
    [...document.querySelectorAll(".rail__item")]
      .find((n) => n.textContent.startsWith("Employment"))
      .click();
    await settle();

    document.querySelector(".panel__add").click();
    await settle();
    expect(document.querySelectorAll(".panel .card")).toHaveLength(2);
    expect((await area.get(["profile"])).profile.work).toHaveLength(2);

    // With more than one entry, each card offers a Remove button.
    document.querySelector(".card__head .jf-button--danger").click();
    await settle();
    expect(document.querySelectorAll(".panel .card")).toHaveLength(1);
  });

  it("never offers to remove the only entry", async () => {
    [...document.querySelectorAll(".rail__item")]
      .find((n) => n.textContent.startsWith("Employment"))
      .click();
    await settle();
    // Leaving zero entries would render an empty panel with no way back.
    expect(document.querySelector(".card__head .jf-button--danger")).toBeNull();
  });

  it("tells the user demographics filling is off", async () => {
    [...document.querySelectorAll(".rail__item")]
      .find((n) => n.textContent.startsWith("Voluntary"))
      .click();
    await settle();

    expect(document.querySelector(".panel__note").textContent).toMatch(/is OFF/);
  });

  it("does not count seeded defaults as progress", async () => {
    // Two sections ship with values the user never typed: every demographic
    // starts at "prefer not to say", and signature.signatureDate at "Today's
    // date". Counting either would credit work nobody did.
    expect(document.querySelector(".rail__pct").textContent).toBe("0%");

    const countFor = (prefix) =>
      [...document.querySelectorAll(".rail__item")]
        .find((n) => n.textContent.startsWith(prefix))
        .querySelector(".rail__count").textContent;

    expect(countFor("Voluntary")).toBe("0/7");
    expect(countFor("Signature")).toBe("0/3");
  });

  it("counts a demographic answer the user actually chose", async () => {
    [...document.querySelectorAll(".rail__item")]
      .find((n) => n.textContent.startsWith("Voluntary"))
      .click();
    await settle();

    const gender = document.getElementById("f-demographics-gender");
    gender.value = "Female";
    gender.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    const count = [...document.querySelectorAll(".rail__item")]
      .find((n) => n.textContent.startsWith("Voluntary"))
      .querySelector(".rail__count").textContent;
    expect(count).toBe("1/7");
  });

  it("renders the settings panel with the demographics gate off", async () => {
    [...document.querySelectorAll(".rail__item")]
      .find((n) => n.textContent === "Settings")
      .click();
    await settle();

    const gate = document.getElementById("set-fillDemographics");
    expect(gate.checked).toBe(false);
    expect(gate.closest(".setting").className).toContain("setting--gated");
  });

  it("saves a settings change", async () => {
    [...document.querySelectorAll(".rail__item")]
      .find((n) => n.textContent === "Settings")
      .click();
    await settle();

    const toggle = document.getElementById("set-overwriteExisting");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    expect((await area.get(["settings"])).settings.overwriteExisting).toBe(true);
  });

  it("shows an empty state for snippets rather than a blank panel", async () => {
    [...document.querySelectorAll(".rail__item")]
      .find((n) => n.textContent === "Snippets")
      .click();
    await settle();

    expect(document.querySelector(".empty").textContent).toMatch(/no snippets yet/i);
    expect(document.querySelector(".panel__add").textContent).toMatch(/add a snippet/i);
  });
});

describe("derived field previews", () => {
  it("offers a computed full name once first and last are entered", async () => {
    const area = createFakeStorageArea({
      profile: { identity: { firstName: "Ada", lastName: "Lovelace" } },
    });
    await bootPage(area);

    // The affordance that makes leaving a derived field blank feel safe.
    const derived = [...document.querySelectorAll(".field__help--derived")]
      .map((n) => n.textContent)
      .join(" ");
    expect(derived).toContain("Ada Lovelace");
    expect(document.getElementById("f-identity-fullName").placeholder).toBe("Ada Lovelace");
  });
});
