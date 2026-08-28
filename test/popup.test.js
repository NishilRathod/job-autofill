/**
 * The popup.
 *
 * The preview is the safety check the whole manual-trigger design rests on, so
 * the behaviour worth protecting is that it shows every value before anything
 * is written, and that unticking a row genuinely removes it from what gets
 * sent — not just from what is displayed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A plan shaped the way the service worker returns one. */
function samplePlan(overrides = {}) {
  return {
    url: "https://job-boards.greenhouse.io/acme/jobs/1",
    title: "Apply",
    adapter: null,
    settings: { highlightFilled: true },
    plan: [
      { fieldId: "f1", path: "identity.firstName", label: "First Name", preview: "Ada", reason: 'label matches "first name"', score: 78 },
      { fieldId: "f2", path: "identity.email", label: "Email", preview: "ada@example.com", reason: 'autocomplete="email"', score: 100 },
    ],
    skipped: [{ fieldId: "f3", label: "Gender", reason: "Self-identification filling is turned off" }],
    unmatched: [{ fieldId: "f4", label: "What is your favourite tool?", signature: "text|q #||favourite tool" }],
    ...overrides,
  };
}

/** Boot the popup against a stubbed service worker. */
async function bootPopup(responder) {
  const html = readFileSync(resolve(ROOT, "src/ui/popup/popup.html"), "utf8");
  document.documentElement.innerHTML = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/[\s\S]*<head>/, "<head>")
    .replace(/<\/html>/, "");

  const sendMessage = vi.fn(responder);
  globalThis.chrome = {
    runtime: { sendMessage, openOptionsPage: vi.fn() },
  };
  globalThis.close = vi.fn();

  vi.resetModules();
  await import("../src/ui/popup/popup.js");
  await settle();
  return { sendMessage };
}

/** Default responder: a successful scan, then echo back whatever is applied. */
const happyPath = (plan = samplePlan()) => async (message) => {
  if (message.type === "SCAN") return plan;
  if (message.type === "APPLY") {
    return { filled: message.plan.map((i) => ({ ...i, note: "" })), failed: [] };
  }
  if (message.type === "UNDO") return { restored: 2 };
  return { ok: true };
};

describe("scanning", () => {
  it("asks the service worker to scan as soon as it opens", async () => {
    const { sendMessage } = await bootPopup(happyPath());
    expect(sendMessage).toHaveBeenCalledWith({ type: "SCAN" });
  });

  it("shows the site being filled", async () => {
    await bootPopup(happyPath());
    // www. is stripped; the hostname is what identifies the job board.
    expect(document.getElementById("site").textContent).toBe("job-boards.greenhouse.io");
  });

  it("explains a page it cannot read, and offers a retry", async () => {
    await bootPopup(async () => ({ error: "Chrome does not allow extensions to run on this page." }));
    expect(document.querySelector(".state--error").textContent).toMatch(/does not allow/i);
    expect(document.querySelector("#footer button").textContent).toBe("Try again");
  });
});

describe("the preview", () => {
  beforeEach(async () => {
    await bootPopup(happyPath());
  });

  it("shows every value before anything is written", async () => {
    const values = [...document.querySelectorAll(".row__value")].map((n) => n.textContent);
    expect(values).toContain("Ada");
    expect(values).toContain("ada@example.com");
  });

  it("counts the fields on the Fill button", () => {
    expect(document.querySelector("#footer button").textContent).toBe("Fill 2 fields");
  });

  it("names the site adapter, or says the match was generic", () => {
    expect(document.querySelector(".summary .jf-mono").textContent).toBe("generic match");
  });

  it("lists what it deliberately left alone, with the reason", () => {
    const text = document.querySelector(".group").parentElement.textContent;
    expect(text).toMatch(/Self-identification filling is turned off/);
  });

  it("offers to learn a field it could not place", () => {
    const learn = document.querySelector(".learn");
    expect(learn.textContent).toMatch(/favourite tool/i);
    expect(learn.querySelector("select")).toBeTruthy();
  });

  it("uses the singular for a single field", async () => {
    await bootPopup(happyPath(samplePlan({ plan: [samplePlan().plan[0]] })));
    expect(document.querySelector("#footer button").textContent).toBe("Fill 1 field");
  });
});

describe("choosing what to fill", () => {
  it("removes an unticked row from what gets sent", async () => {
    // The important one: unticking must change the message, not just the view.
    const { sendMessage } = await bootPopup(happyPath());

    const [firstCheck] = document.querySelectorAll(".row__check");
    firstCheck.checked = false;
    firstCheck.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    expect(document.querySelector("#footer button").textContent).toBe("Fill 1 field");

    document.querySelector("#footer button").click();
    await settle();

    const applied = sendMessage.mock.calls.find(([m]) => m.type === "APPLY")[0];
    expect(applied.plan.map((i) => i.fieldId)).toEqual(["f2"]);
  });

  it("disables the button when nothing is selected", async () => {
    await bootPopup(happyPath());
    for (const check of document.querySelectorAll(".row__check")) {
      check.checked = false;
      check.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await settle();

    const fill = document.querySelector("#footer button");
    expect(fill.disabled).toBe(true);
    expect(fill.textContent).toBe("Nothing selected");
  });

  it("asks the page to reveal a field when its row is clicked", async () => {
    const { sendMessage } = await bootPopup(happyPath());
    document.querySelector(".row").click();
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({ type: "REVEAL", fieldId: "f1" });
  });
});

describe("learn mode", () => {
  it("stores a taught mapping and rescans so the lesson is visible", async () => {
    const { sendMessage } = await bootPopup(happyPath());

    const select = document.querySelector(".learn select");
    select.value = "skills.summary";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    const learn = sendMessage.mock.calls.find(([m]) => m.type === "LEARN")[0];
    expect(learn.path).toBe("skills.summary");
    expect(learn.signature).toBe("text|q #||favourite tool");

    // A rescan is what makes the newly taught field appear in the preview.
    expect(sendMessage.mock.calls.filter(([m]) => m.type === "SCAN")).toHaveLength(2);
  });

  it("does nothing when the placeholder option is chosen", async () => {
    const { sendMessage } = await bootPopup(happyPath());
    const select = document.querySelector(".learn select");
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(sendMessage.mock.calls.some(([m]) => m.type === "LEARN")).toBe(false);
  });
});

describe("results", () => {
  it("reports what was filled and offers undo", async () => {
    await bootPopup(happyPath());
    document.querySelector("#footer button").click();
    await settle();

    expect(document.querySelector(".summary__count").textContent).toBe("Filled 2");
    expect([...document.querySelectorAll("#footer button")].map((b) => b.textContent))
      .toEqual(["Undo", "Scan again"]);
  });

  it("shows fields it could not fill rather than swallowing them", async () => {
    // A field JobFill failed on is one the user still has to fill themselves,
    // so hiding it would be actively harmful.
    await bootPopup(async (message) => {
      if (message.type === "SCAN") return samplePlan();
      return { filled: [], failed: [{ fieldId: "f1", label: "Country", note: "Could not find \"United Kingdom\" in the dropdown" }] };
    });
    document.querySelector("#footer button").click();
    await settle();

    expect(document.body.textContent).toMatch(/Could not fill/);
    expect(document.body.textContent).toMatch(/United Kingdom/);
  });

  it("confirms how many fields undo restored", async () => {
    await bootPopup(happyPath());
    document.querySelector("#footer button").click();
    await settle();

    document.querySelector("#footer button").click(); // Undo
    await settle();
    expect(document.querySelector(".state__title").textContent).toBe("Restored 2 fields");
  });
});

describe("empty profile", () => {
  it("offers to open the editor instead of just reporting the problem", async () => {
    // Recognising fields but having nothing to put in them is the most likely
    // first-run experience, and the fix should be one click away.
    await bootPopup(happyPath(samplePlan({
      plan: [],
      unmatched: [],
      skipped: [
        { fieldId: "a", label: "First Name", reason: "Nothing saved for this field yet" },
        { fieldId: "b", label: "Email", reason: "Nothing saved for this field yet" },
      ],
    })));

    expect(document.querySelector(".state__title").textContent).toBe("Your profile is empty");
    const action = document.querySelector("#footer button");
    expect(action.textContent).toBe("Set up your profile");

    action.click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it("says so plainly when the page has no form at all", async () => {
    await bootPopup(happyPath(samplePlan({ plan: [], skipped: [], unmatched: [] })));
    expect(document.querySelector(".state__title").textContent).toBe("No form found here");
  });
});

describe("profile link", () => {
  it("is always available in the header", async () => {
    await bootPopup(happyPath());
    document.getElementById("open-options").click();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });
});
