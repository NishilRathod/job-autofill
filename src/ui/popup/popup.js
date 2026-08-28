/**
 * Popup controller.
 *
 * Opening the popup scans the page and shows exactly what JobFill intends to
 * write, field by field, before anything is written. That preview is the safety
 * check the entire manual-trigger design rests on — it is why this extension
 * can be trusted with a form somebody is about to submit under their own name.
 *
 * All the deciding happens in the service worker. This file asks for a plan,
 * renders it, and sends back whichever rows the user kept.
 */

import { ALL_FIELDS } from "../../core/schema.js";

const bodyNode = document.getElementById("body");
const footerNode = document.getElementById("footer");
const siteNode = document.getElementById("site");

/** The plan from the last scan, plus which rows are still ticked. */
let current = null;
const excluded = new Set();

/** Shorthand element builder. */
function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/** Ask the service worker to do something, surfacing its errors as throws. */
async function ask(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function showState({ title, detail, modifier = "", spinner = false }) {
  bodyNode.replaceChildren(
    el("div", { className: `state ${modifier}` }, [
      spinner ? el("div", { className: "spinner" }) : null,
      el("div", { className: "state__title", textContent: title }),
      detail ? el("p", { className: "state__detail", textContent: detail }) : null,
    ])
  );
}

function showError(message) {
  showState({ title: "Can't fill this page", detail: message, modifier: "state--error" });
  footerNode.replaceChildren(
    button("Try again", "jf-button", () => scan())
  );
}

function button(text, className, onClick) {
  const node = el("button", { type: "button", className, textContent: text });
  node.addEventListener("click", onClick);
  return node;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** One row of the preview: a tick, the field's label, and the value to write. */
function previewRow(item) {
  const check = el("input", { type: "checkbox", className: "row__check", checked: !excluded.has(item.fieldId) });
  check.addEventListener("click", (event) => event.stopPropagation());
  check.addEventListener("change", () => {
    if (check.checked) excluded.delete(item.fieldId);
    else excluded.add(item.fieldId);
    renderFooter();
  });

  // Clicking the row scrolls the page to that field and outlines it, so a value
  // that looks wrong can be checked against the form itself.
  const row = el("button", { type: "button", className: "row" }, [
    check,
    el("span", { className: "row__label", textContent: item.label, title: item.label }),
    el("span", { className: "row__value", textContent: item.preview }),
  ]);
  row.addEventListener("click", () => ask({ type: "REVEAL", fieldId: item.fieldId }).catch(() => {}));
  row.title = item.reason;
  return row;
}

/** A read-only row for something JobFill decided not to fill. */
function noteRow(item) {
  return el("div", { className: "row row--muted" }, [
    el("span"),
    el("span", { className: "row__label", textContent: item.label, title: item.label }),
    el("span", { className: "row__why", textContent: item.reason }),
  ]);
}

/**
 * A row offering to learn an unrecognised field.
 *
 * This is what makes JobFill improve on the sites you actually use. The mapping
 * is stored against this domain only, so a correction here cannot leak onto an
 * unrelated job board.
 */
function learnRow(item) {
  const select = el("select", {}, [
    el("option", { value: "", textContent: "Teach JobFill this field…" }),
    ...ALL_FIELDS.map((field) =>
      el("option", { value: field.path, textContent: `${field.sectionId} → ${field.label}` })
    ),
  ]);

  select.addEventListener("change", async () => {
    if (!select.value) return;
    await ask({ type: "LEARN", signature: item.signature, path: select.value });
    // Rescan so the taught field appears in the preview immediately — otherwise
    // there is no sign the lesson took.
    scan();
  });

  return el("div", { className: "learn" }, [
    el("span", { className: "learn__label", textContent: item.label, title: item.label }),
    select,
  ]);
}

function group(title, count, rows) {
  return el("div", { className: "group" }, [
    el("div", { className: "group__head" }, [
      el("span", { textContent: title }),
      el("span", { className: "jf-mono", textContent: String(count) }),
    ]),
    el("div", { className: "rows" }, rows),
  ]);
}

function renderPreview() {
  const { plan, skipped, unmatched } = current;

  if (!plan.length && !skipped.length && !unmatched.length) {
    showState({
      title: "No form found here",
      detail: "JobFill could not find any fields on this page. Open the application form first.",
    });
    footerNode.replaceChildren();
    return;
  }

  // Recognised the fields but has nothing to put in them: the profile is
  // empty. An error message would describe the problem; this offers the fix.
  const nothingSaved = skipped.filter((item) => /nothing saved/i.test(item.reason));
  if (!plan.length && nothingSaved.length >= 2) {
    showState({
      title: "Your profile is empty",
      detail: `JobFill recognised ${nothingSaved.length} fields on this page but has nothing saved to put in them.`,
    });
    footerNode.replaceChildren(
      button("Set up your profile", "jf-button jf-button--primary", () => chrome.runtime.openOptionsPage())
    );
    return;
  }

  const sections = [];

  if (plan.length) {
    sections.push(
      el("div", { className: "summary" }, [
        el("span", { className: "summary__count", textContent: `${plan.length} field${plan.length === 1 ? "" : "s"}` }),
        el("span", { className: "jf-mono", textContent: current.adapter ?? "generic match" }),
      ]),
      el("div", { className: "rows" }, plan.map(previewRow))
    );
  }

  if (unmatched.length) {
    sections.push(group("Not recognised", unmatched.length, unmatched.map(learnRow)));
  }

  if (skipped.length) {
    sections.push(group("Left alone", skipped.length, skipped.map(noteRow)));
  }

  bodyNode.replaceChildren(...sections);
  renderFooter();
}

function renderFooter() {
  const count = current.plan.length - excluded.size;

  footerNode.replaceChildren(
    button(
      count ? `Fill ${count} field${count === 1 ? "" : "s"}` : "Nothing selected",
      "jf-button jf-button--primary",
      applyFill
    ),
    el("p", { className: "jf-mono hint", textContent: "alt+shift+F fills without this preview" })
  );
  footerNode.querySelector("button").disabled = count === 0;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function renderResult({ filled, failed }) {
  const sections = [
    el("div", { className: "summary" }, [
      el("span", { className: "summary__count", textContent: `Filled ${filled.length}` }),
      el("span", { className: "jf-mono", textContent: "check before submitting" }),
    ]),
  ];

  if (filled.length) {
    sections.push(el("div", { className: "rows" }, filled.map(noteRowFilled)));
  }

  // Failures are shown, not swallowed: a field JobFill could not fill is one
  // the user still has to fill, and they need to know which.
  if (failed.length) {
    sections.push(
      group("Could not fill", failed.length, failed.map((item) =>
        el("div", { className: "row row--muted" }, [
          el("span"),
          el("span", { className: "row__label", textContent: item.label }),
          el("span", { className: "row__why", textContent: item.note }),
        ])
      ))
    );
  }

  bodyNode.replaceChildren(...sections);

  footerNode.replaceChildren(
    el("div", { className: "footer__row" }, [
      button("Undo", "jf-button", async () => {
        const { restored } = await ask({ type: "UNDO" });
        showState({ title: `Restored ${restored} field${restored === 1 ? "" : "s"}` });
        footerNode.replaceChildren(button("Scan again", "jf-button", () => scan()));
      }),
      button("Scan again", "jf-button", () => scan()),
    ])
  );
}

function noteRowFilled(item) {
  return el("div", { className: "row" }, [
    el("span"),
    el("span", { className: "row__label", textContent: item.label }),
    el("span", { className: "row__value", textContent: item.preview ?? "" }),
  ]);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function applyFill() {
  const plan = current.plan.filter((item) => !excluded.has(item.fieldId));
  showState({ title: "Filling…", spinner: true });
  footerNode.replaceChildren();

  try {
    const result = await ask({
      type: "APPLY",
      plan,
      skippedCount: current.skipped.length,
      settings: current.settings,
    });
    renderResult(result);
  } catch (error) {
    showError(error.message);
  }
}

async function scan() {
  excluded.clear();
  showState({ title: "Reading this page…", spinner: true });
  footerNode.replaceChildren();

  try {
    current = await ask({ type: "SCAN" });
    siteNode.textContent = new URL(current.url).hostname.replace(/^www\./, "");
    renderPreview();
  } catch (error) {
    showError(error.message);
  }
}

document.getElementById("open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

scan();
