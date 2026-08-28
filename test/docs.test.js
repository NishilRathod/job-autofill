/**
 * Keeps generated documentation honest.
 *
 * docs/FIELD-REFERENCE.md is produced from schema.js. Without this check it
 * would silently go stale the first time someone adds a field and forgets to
 * run `npm run docs`, which quietly turns the documentation into a liability.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../tools/gen-field-reference.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("docs/FIELD-REFERENCE.md", () => {
  it("matches what the schema currently generates", () => {
    const committed = readFileSync(resolve(ROOT, "docs/FIELD-REFERENCE.md"), "utf8");
    // Normalise line endings: .gitattributes checks out LF, but an editor on
    // Windows may still write CRLF, and that difference is not staleness.
    const normalise = (text) => text.replace(/\r\n/g, "\n").trimEnd();
    expect(
      normalise(committed),
      "docs/FIELD-REFERENCE.md is out of date — run `npm run docs`"
    ).toBe(normalise(build()));
  });
});
