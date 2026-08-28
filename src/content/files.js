/**
 * Attaching a stored document to a file input.
 *
 * Classic script sharing globalThis.JobFill — see collect.js for why.
 *
 * `input.files` is read-only, but it accepts a FileList taken from a
 * DataTransfer. Building one is the only way to attach a file without a real
 * file-picker gesture, and it is what makes "upload your resume" a solved
 * problem rather than the one step you still do by hand every time.
 *
 * The bytes arrive base64-encoded in the fill plan. They have to: a content
 * script's IndexedDB belongs to the page, not the extension, so it cannot read
 * the document store directly — and chrome.runtime messages are JSON, which
 * does not carry a Blob. The service worker reads the blob and encodes it.
 */

globalThis.JobFill = globalThis.JobFill || {};

(() => {
  const NS = globalThis.JobFill;

  /** Decode base64 into bytes, in chunks so a large resume does not blow the stack. */
  function decodeBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /**
   * Attach a document to a file input.
   *
   * @param {HTMLInputElement} input
   * @param {{name: string, type: string, base64: string}} document
   * @returns {Promise<{ok: boolean, note?: string}>}
   */
  async function attach(input, document) {
    if (!document?.base64) return { ok: false, note: "No document stored for this field" };
    if (input.tagName !== "INPUT" || input.type !== "file") {
      return { ok: false, note: "That field does not take a file" };
    }

    const file = new File([decodeBase64(document.base64)], document.name, {
      type: document.type || "application/octet-stream",
    });

    // Respect the input's own accept list rather than attaching something the
    // form will reject on submit, long after the user has stopped looking.
    if (input.accept && !acceptsFile(input.accept, file)) {
      return { ok: false, note: `This upload only accepts ${input.accept}` };
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;

    // A file input's own events, in the order a real picker produces them.
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // Drag-and-drop uploaders often listen for a drop instead of watching the
    // input, so give them the event they are waiting for as well.
    const dropZone = input.closest("[data-testid*='drop'], .dropzone, [class*='drop']");
    if (dropZone) {
      dropZone.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    }

    return input.files.length === 1
      ? { ok: true }
      : { ok: false, note: "The page would not accept the file" };
  }

  /** Whether a file satisfies an input's `accept` attribute. */
  function acceptsFile(accept, file) {
    const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
    return accept
      .split(",")
      .map((rule) => rule.trim().toLowerCase())
      .some((rule) => {
        if (!rule) return true;
        if (rule.startsWith(".")) return rule === extension;
        if (rule.endsWith("/*")) return file.type.startsWith(rule.slice(0, -1));
        return rule === file.type;
      });
  }

  NS.files = { attach, acceptsFile, decodeBase64 };
})();
