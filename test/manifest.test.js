/**
 * Structural checks on manifest.json.
 *
 * A mistyped path in the manifest is one of the easiest ways to ship a broken
 * extension: Chrome reports it as a load error only when someone actually
 * reloads the unpacked folder, which may be long after the typo was written.
 * These tests catch it in CI instead.
 *
 * Privacy-related manifest assertions deliberately live in no-network.test.js,
 * next to the rest of the privacy guarantees.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

/** Every path the manifest points at, flattened into a checkable list. */
function referencedPaths() {
  const paths = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ];
  return [...new Set(paths.filter(Boolean))];
}

describe("manifest.json", () => {
  it("is Manifest V3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it.each(referencedPaths())("references a file that exists: %s", (path) => {
    expect(existsSync(join(ROOT, path))).toBe(true);
  });

  it("provides every icon size Chrome asks for", () => {
    // 16 toolbar, 32 Windows, 48 extensions page, 128 install dialog and store.
    // Omitting a size makes Chrome upscale a smaller one, which looks soft.
    expect(Object.keys(manifest.icons).sort()).toEqual(["128", "16", "32", "48"]);
  });

  it("uses a module service worker", () => {
    // The worker imports from src/core, so it must be a module. Getting this
    // wrong produces an import error that only shows in the worker's own
    // console, which is easy to miss.
    expect(manifest.background.type).toBe("module");
  });

  it("keeps the extension version and package version in step", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(manifest.version).toBe(pkg.version);
  });

  it("declares keyboard shortcuts with descriptions", () => {
    // Chrome shows these strings on chrome://extensions/shortcuts. A command
    // without a description renders as a blank row.
    for (const [name, command] of Object.entries(manifest.commands ?? {})) {
      expect(command.description, `command "${name}" needs a description`).toBeTruthy();
    }
  });
});

describe("extension pages", () => {
  const pages = [manifest.action.default_popup, manifest.options_ui.page];

  it.each(pages)("%s references only local assets that exist", (page) => {
    const html = readFileSync(join(ROOT, page), "utf8");
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      // A remote asset would be blocked by the CSP at runtime and would leak a
      // request revealing that the user opened the extension.
      expect(ref, `${page} must not load remote assets`).not.toMatch(/^https?:/);
      expect(
        existsSync(resolve(ROOT, dirname(page), ref)),
        `${page} references missing asset ${ref}`
      ).toBe(true);
    }
  });
});
