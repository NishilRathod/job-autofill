/**
 * Writes values into form controls, and remembers how to put them back.
 *
 * Classic script sharing globalThis.JobFill — see collect.js for why.
 *
 * The hard part is not assignment, it is convincing a framework that the user
 * typed. React, Vue and Angular all track input state internally, and a plain
 * `element.value = "Ada"` updates what the user sees while leaving the
 * framework's own state empty. The form then submits blank, which is a
 * particularly cruel failure: the page looks filled right up until it isn't.
 */

globalThis.JobFill = globalThis.JobFill || {};

(() => {
  const NS = globalThis.JobFill;

  /**
   * Assign a value the way a real keystroke would.
   *
   * React attaches its own `value` setter to the element instance, which
   * swallows programmatic writes. Calling the *prototype's* setter bypasses
   * that shadowing, and the subsequent `input` event is what React listens for
   * to sync its state. This is the single most important function in the file.
   */
  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  /**
   * Fire the events a framework needs to notice the change.
   *
   * `input` then `change` matches what a browser emits for typing followed by
   * blur. `blur` last, because many forms only validate on blur and a field
   * that never blurs shows as untouched-but-invalid on submit.
   */
  function notify(element, { blur = true } = {}) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    if (blur) element.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  }

  /**
   * The undo journal for the current page.
   *
   * Holds the previous state of everything the last fill touched. Kept in
   * memory only: after a reload the form is back to its own state anyway, so
   * persisting it would only create a way to "undo" onto a different page.
   */
  let journal = [];

  /** Record how to restore a control before changing it. */
  function remember(element) {
    if (element.type === "checkbox" || element.type === "radio") {
      journal.push({ element, kind: "checked", value: element.checked });
    } else if (element.isContentEditable) {
      journal.push({ element, kind: "html", value: element.innerHTML });
    } else if (element.type === "file") {
      journal.push({ element, kind: "files", value: element.files });
    } else {
      journal.push({ element, kind: "value", value: element.value });
    }
  }

  /**
   * Apply one fill instruction.
   *
   * @param {Element} element
   * @param {{kind: string, value: *}} instruction  From core/value-format.js.
   * @returns {Promise<{ok: boolean, note?: string}>}
   */
  async function applyOne(element, instruction) {
    remember(element);

    try {
      switch (instruction.kind) {
        case "text":
          if (element.isContentEditable) {
            element.textContent = instruction.value;
            notify(element, { blur: false });
          } else {
            element.focus?.({ preventScroll: true });
            setNativeValue(element, instruction.value);
            notify(element);
          }
          return { ok: true };

        case "boolean":
          if (element.checked !== instruction.value) {
            // Clicking rather than assigning, so that handlers bound to the
            // click (which is how most custom checkboxes work) still run.
            element.click();
          }
          return { ok: element.checked === instruction.value };

        case "option":
          return await NS.widgets.selectOption(element, instruction.value);

        case "file":
          return await NS.files.attach(element, instruction.file);

        default:
          return { ok: false, note: `Unknown instruction "${instruction.kind}"` };
      }
    } catch (error) {
      // One awkward field must never abort the rest of the form.
      return { ok: false, note: error.message };
    }
  }

  /**
   * Carry out a whole fill plan.
   *
   * @param {Array<{fieldId: string, instruction: object, label: string, path: string}>} plan
   * @param {Map<string, Element>} elements
   * @param {{highlight?: boolean}} [options]
   * @returns {Promise<{filled: object[], failed: object[]}>}
   */
  async function applyPlan(plan, elements, { highlight = true } = {}) {
    journal = []; // a new fill replaces what undo would restore
    const filled = [];
    const failed = [];

    for (const item of plan) {
      const element = elements.get(item.fieldId);
      if (!element) {
        failed.push({ ...item, note: "That field is no longer on the page" });
        continue;
      }

      const result = await applyOne(element, item.instruction);
      if (result.ok) {
        filled.push(item);
        if (highlight) NS.overlay?.highlight(element);
      } else {
        // Nothing was written, so drop the journal entry rather than leaving a
        // no-op that makes the undo count wrong.
        journal.pop();
        failed.push({ ...item, note: result.note ?? "Could not fill this field" });
      }
    }

    return { filled, failed };
  }

  /**
   * Restore everything the last fill changed.
   * @returns {number} How many fields were restored.
   */
  function undo() {
    let restored = 0;

    // Reverse order, so a field touched twice ends at its original value.
    for (const entry of [...journal].reverse()) {
      const { element, kind, value } = entry;
      if (!element.isConnected) continue;

      try {
        if (kind === "checked") {
          if (element.checked !== value) element.click();
        } else if (kind === "html") {
          element.innerHTML = value;
        } else if (kind === "files") {
          element.files = value;
          notify(element, { blur: false });
        } else {
          setNativeValue(element, value);
          notify(element, { blur: false });
        }
        NS.overlay?.clearHighlight(element);
        restored += 1;
      } catch {
        // A field that refuses to be restored is not worth failing the rest.
      }
    }

    journal = [];
    return restored;
  }

  /** Whether there is anything to undo. Drives the toast's Undo button. */
  const canUndo = () => journal.length > 0;

  NS.fill = { applyPlan, applyOne, undo, canUndo, setNativeValue, notify };
})();
