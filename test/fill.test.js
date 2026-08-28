/**
 * Writing values into a page, and taking them back.
 *
 * The failure this suite guards hardest against is the framework one: a plain
 * `element.value = "Ada"` updates what the user sees while leaving React's own
 * state empty, so the form submits blank. The page looks filled right up until
 * it isn't, which is the worst possible way for an autofill tool to fail.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadContentScripts, loadFixture } from "./helpers/load-content-script.js";

let NS;

beforeEach(() => {
  loadFixture("<form></form>");
  // Re-injected each time so state (the undo journal) does not leak between
  // tests, which is also what happens on a real page reload.
  delete globalThis.JobFill;
  NS = loadContentScripts("collect.js", "widgets.js", "files.js", "fill.js", "overlay.js");
});

/** Put HTML on the page and return a collected element map. */
function page(html) {
  loadFixture(html);
  const { descriptors, elements } = NS.collect(document);
  return { descriptors, elements, byId: (id) => document.getElementById(id) };
}

describe("setNativeValue", () => {
  it("writes through a value setter a framework has shadowed", () => {
    // React installs its own `value` setter on the element instance, which
    // swallows a direct assignment. Calling the prototype setter is what gets
    // past it, and is the reason this function exists at all.
    const { byId } = page(`<input id="a" type="text" />`);
    const input = byId("a");

    let swallowed = false;
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: () => { swallowed = true; },
    });

    NS.fill.setNativeValue(input, "Ada");

    expect(swallowed, "the instance setter should have been bypassed").toBe(false);
    // Reading through the shadowing getter still returns "", but the real
    // underlying value was set — which is what the framework reads.
    delete input.value;
    expect(input.value).toBe("Ada");
  });

  it("fires input and change so a framework notices", () => {
    const { byId } = page(`<input id="a" type="text" />`);
    const input = byId("a");
    const seen = [];
    for (const type of ["input", "change", "blur"]) {
      input.addEventListener(type, () => seen.push(type));
    }

    NS.fill.setNativeValue(input, "Ada");
    NS.fill.notify(input);

    expect(seen).toEqual(["input", "change", "blur"]);
  });
});

describe("applyPlan", () => {
  it("fills a text input", async () => {
    const { elements, descriptors, byId } = page(`<label for="a">First name</label><input id="a" />`);
    const { filled } = await NS.fill.applyPlan(
      [{ fieldId: descriptors[0].fieldId, instruction: { kind: "text", value: "Ada" } }],
      elements
    );
    expect(filled).toHaveLength(1);
    expect(byId("a").value).toBe("Ada");
  });

  it("selects an option in a native dropdown", async () => {
    const { elements, descriptors, byId } = page(`
      <select id="a"><option value="">--</option><option value="uk">United Kingdom</option></select>
    `);
    await NS.fill.applyPlan(
      [{ fieldId: descriptors[0].fieldId, instruction: { kind: "option", value: "United Kingdom" } }],
      elements
    );
    expect(byId("a").value).toBe("uk");
  });

  it("picks the right radio in a group", async () => {
    const { elements, descriptors } = page(`
      <fieldset><legend>Authorized to work?</legend>
        <label><input type="radio" name="auth" value="y" /> Yes</label>
        <label><input type="radio" name="auth" value="n" /> No</label>
      </fieldset>
    `);
    await NS.fill.applyPlan(
      [{ fieldId: descriptors[0].fieldId, instruction: { kind: "option", value: "No" } }],
      elements
    );
    expect(document.querySelector('input[value="n"]').checked).toBe(true);
    expect(document.querySelector('input[value="y"]').checked).toBe(false);
  });

  it("ticks a checkbox by clicking it", async () => {
    // Clicking rather than assigning `checked`, because custom-drawn checkboxes
    // bind their visual state to the click event.
    const { elements, descriptors, byId } = page(`<label for="a">Current role</label><input id="a" type="checkbox" />`);
    const clicks = vi.fn();
    byId("a").addEventListener("click", clicks);

    await NS.fill.applyPlan(
      [{ fieldId: descriptors[0].fieldId, instruction: { kind: "boolean", value: true } }],
      elements
    );
    expect(byId("a").checked).toBe(true);
    expect(clicks).toHaveBeenCalled();
  });

  it("leaves an already-correct checkbox alone", async () => {
    const { elements, descriptors, byId } = page(`<label for="a">Current role</label><input id="a" type="checkbox" checked />`);
    const clicks = vi.fn();
    byId("a").addEventListener("click", clicks);

    await NS.fill.applyPlan(
      [{ fieldId: descriptors[0].fieldId, instruction: { kind: "boolean", value: true } }],
      elements
    );
    // Clicking it would have turned it off.
    expect(clicks).not.toHaveBeenCalled();
    expect(byId("a").checked).toBe(true);
  });

  it("keeps going after one field fails", async () => {
    // A single awkward field must never cost the user the rest of the form.
    const { elements, descriptors, byId } = page(`
      <label for="a">First name</label><input id="a" />
      <select id="b"><option>Only choice</option></select>
      <label for="c">Last name</label><input id="c" />
    `);
    const [a, b, c] = descriptors.map((d) => d.fieldId);

    const { filled, failed } = await NS.fill.applyPlan(
      [
        { fieldId: a, instruction: { kind: "text", value: "Ada" } },
        { fieldId: b, instruction: { kind: "option", value: "Not present" } },
        { fieldId: c, instruction: { kind: "text", value: "Lovelace" } },
      ],
      elements
    );

    expect(filled).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(byId("a").value).toBe("Ada");
    expect(byId("c").value).toBe("Lovelace");
  });

  it("reports a field the plan names but the page no longer has", async () => {
    // Happens when a single-page app re-renders the form between the scan and
    // the user pressing Fill. It must be reported, not thrown.
    const { elements } = page(`<label for="a">First name</label><input id="a" />`);

    const { filled, failed } = await NS.fill.applyPlan(
      [{ fieldId: "no-such-field", instruction: { kind: "text", value: "Ada" } }],
      elements
    );
    expect(filled).toHaveLength(0);
    expect(failed[0].note).toMatch(/no longer on the page/i);
  });
});

describe("undo", () => {
  it("restores what a fill overwrote", async () => {
    const { elements, descriptors, byId } = page(`
      <label for="a">First name</label><input id="a" value="existing" />
      <label for="b">Notes</label><textarea id="b">keep me</textarea>
    `);
    const [a, b] = descriptors.map((d) => d.fieldId);

    await NS.fill.applyPlan(
      [
        { fieldId: a, instruction: { kind: "text", value: "Ada" } },
        { fieldId: b, instruction: { kind: "text", value: "replaced" } },
      ],
      elements
    );
    expect(byId("a").value).toBe("Ada");

    expect(NS.fill.undo()).toBe(2);
    expect(byId("a").value).toBe("existing");
    expect(byId("b").value).toBe("keep me");
  });

  it("unticks a checkbox it ticked", async () => {
    const { elements, descriptors, byId } = page(`<label for="a">Current</label><input id="a" type="checkbox" />`);
    await NS.fill.applyPlan(
      [{ fieldId: descriptors[0].fieldId, instruction: { kind: "boolean", value: true } }],
      elements
    );
    NS.fill.undo();
    expect(byId("a").checked).toBe(false);
  });

  it("does not count a field it failed to fill", async () => {
    // A journal entry for a field nothing was written to would make undo claim
    // to have restored more than it did.
    const { elements, descriptors } = page(`<select id="a"><option>Only choice</option></select>`);
    await NS.fill.applyPlan(
      [{ fieldId: descriptors[0].fieldId, instruction: { kind: "option", value: "Absent" } }],
      elements
    );
    expect(NS.fill.canUndo()).toBe(false);
    expect(NS.fill.undo()).toBe(0);
  });

  it("has nothing to undo before any fill", () => {
    page(`<input id="a" />`);
    expect(NS.fill.canUndo()).toBe(false);
  });

  it("a second fill replaces what undo would restore", async () => {
    const { elements, descriptors, byId } = page(`<label for="a">First name</label><input id="a" value="original" />`);
    const id = descriptors[0].fieldId;

    await NS.fill.applyPlan([{ fieldId: id, instruction: { kind: "text", value: "one" } }], elements);
    await NS.fill.applyPlan([{ fieldId: id, instruction: { kind: "text", value: "two" } }], elements);

    // Undo steps back to the state before the most recent fill, not all the
    // way to the original — which matches what "undo" means everywhere else.
    NS.fill.undo();
    expect(byId("a").value).toBe("one");
  });
});

describe("file attachment", () => {
  /** Base64 for the bytes "PDF". */
  const DOC = { name: "resume.pdf", type: "application/pdf", base64: btoa("PDF") };

  /**
   * jsdom implements no DataTransfer at all, so attaching a file cannot run
   * here unshimmed. This stands in for it.
   *
   * What these tests therefore prove is the part JobFill owns: that the right
   * File is constructed from the stored bytes, that `accept` is honoured, and
   * that the result is assigned to `input.files`. Whether Chrome accepts that
   * assignment is a browser behaviour, and is on the manual checklist in
   * docs/TESTING.md rather than covered here.
   */
  let originalFiles;
  beforeEach(() => {
    globalThis.DataTransfer = class {
      constructor() {
        const list = [];
        this.files = list;
        this.items = { add: (file) => list.push(file) };
      }
    };
    globalThis.DragEvent = globalThis.DragEvent ?? class extends Event {};

    // jsdom's `files` setter silently discards anything that is not a real
    // FileList. Chrome accepts a DataTransfer's FileList, which is the entire
    // basis of this technique, so the stand-in accepts it too.
    originalFiles = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
    Object.defineProperty(HTMLInputElement.prototype, "files", {
      configurable: true,
      get() { return this._shimFiles ?? []; },
      set(value) { this._shimFiles = value; },
    });
  });

  afterEach(() => {
    Object.defineProperty(HTMLInputElement.prototype, "files", originalFiles);
  });

  it("attaches a document to a file input", async () => {
    const { elements, descriptors, byId } = page(`<label for="a">Resume</label><input id="a" type="file" />`);
    const result = await NS.fill.applyPlan(
      [{ fieldId: descriptors[0].fieldId, instruction: { kind: "file", file: DOC } }],
      elements
    );

    expect(result.filled).toHaveLength(1);
    expect(byId("a").files).toHaveLength(1);
    expect(byId("a").files[0].name).toBe("resume.pdf");
  });

  it("refuses a file the input does not accept", async () => {
    // Better to report it than to attach something the form rejects on submit,
    // long after the user has stopped looking.
    const { elements, descriptors } = page(`<label for="a">Resume</label><input id="a" type="file" accept=".doc,.docx" />`);
    const { failed } = await NS.fill.applyPlan(
      [{ fieldId: descriptors[0].fieldId, instruction: { kind: "file", file: DOC } }],
      elements
    );
    expect(failed[0].note).toMatch(/only accepts/i);
  });

  it("reports a missing document rather than attaching nothing", async () => {
    const { elements, descriptors } = page(`<label for="a">Resume</label><input id="a" type="file" />`);
    const { failed } = await NS.fill.applyPlan(
      [{ fieldId: descriptors[0].fieldId, instruction: { kind: "file", file: null } }],
      elements
    );
    expect(failed[0].note).toMatch(/no document stored/i);
  });

  it("accepts a file matching a wildcard mime rule", () => {
    expect(NS.files.acceptsFile("application/*", { name: "a.pdf", type: "application/pdf" })).toBe(true);
    expect(NS.files.acceptsFile("image/*", { name: "a.pdf", type: "application/pdf" })).toBe(false);
  });
});

describe("overlay", () => {
  it("renders the result toast inside a shadow root", () => {
    // Job boards ship aggressive global CSS; a toast that inherits it looks
    // broken in a way that reflects on the extension rather than the site.
    NS.overlay.showResult({ filled: 3, skipped: 1, failed: 0, onUndo: () => 3 });

    const host = document.getElementById("jobfill-overlay-host");
    expect(host.shadowRoot).toBeTruthy();
    expect(host.shadowRoot.querySelector(".toast").textContent).toContain("Filled 3 fields");
    expect(host.shadowRoot.querySelector(".toast").textContent).toContain("1 left alone");
  });

  it("says so plainly when there was nothing to fill", () => {
    NS.overlay.showResult({ filled: 0, skipped: 0, failed: 0 });
    const text = document.getElementById("jobfill-overlay-host").shadowRoot.textContent;
    expect(text).toContain("Nothing to fill here");
  });

  it("offers undo only when something was filled", () => {
    NS.overlay.showResult({ filled: 0, skipped: 2, failed: 0, onUndo: () => 0 });
    const shadow = document.getElementById("jobfill-overlay-host").shadowRoot;
    const buttons = [...shadow.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).not.toContain("Undo");
  });

  it("restores a field's own outline rather than blanking it", () => {
    loadFixture(`<input id="a" style="outline: 1px dotted red" />`);
    const input = document.getElementById("a");

    NS.overlay.highlight(input);
    expect(input.style.outline).toContain("#0f9d6e");

    NS.overlay.clearHighlight(input);
    expect(input.style.outline).toBe("1px dotted red");
  });
});
