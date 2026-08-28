/**
 * Loads a content script into the jsdom global scope.
 *
 * Files under src/content are classic scripts, not ES modules, because
 * chrome.scripting.executeScript injects classic scripts and a top-level
 * `import` would throw. That means a test cannot simply import them.
 *
 * Evaluating the real file — rather than a module-shaped copy — is the point:
 * these tests exercise exactly the code that ships.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Evaluate one or more content scripts, in order, into globalThis.
 * @param {...string} names File names under src/content, e.g. "collect.js".
 * @returns {object} The populated globalThis.JobFill namespace.
 */
export function loadContentScripts(...names) {
  for (const name of names) {
    const source = readFileSync(resolve(ROOT, "src/content", name), "utf8");
    // Indirect eval so the script runs in global scope, exactly as an injected
    // content script does, rather than inside this function's closure.
    (0, eval)(source);
  }
  return globalThis.JobFill;
}

/** Replace the document with the given HTML fixture. */
export function loadFixture(html) {
  document.documentElement.innerHTML = `<head></head><body>${html}</body>`;
  return document;
}
