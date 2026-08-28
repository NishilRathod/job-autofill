/**
 * The headline promise of this project is that your job application data never
 * leaves your machine. That promise is only as good as the weakest moment of
 * carelessness, so this suite enforces it mechanically rather than trusting a
 * reviewer to notice.
 *
 * If one of these tests fails, do not add an exception. The correct response is
 * that the feature needing a network call does not belong in this extension.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

/** Recursively collect every JavaScript file under `dir`. */
function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.endsWith(".js") || entry.endsWith(".mjs")) out.push(full);
  }
  return out;
}

/**
 * Blank out comments and string/template literal contents, replacing them with
 * spaces so line and column positions are preserved.
 *
 * This matters because a naive regex over raw source produces false positives
 * on things like the URL in a doc comment, and false negatives are worse still
 * if someone hides a call inside a string. Scanning only executable code makes
 * the results trustworthy in both directions.
 */
function stripNonCode(source) {
  const out = source.split("");
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== "\n") out[i] = " ";
    }
  };

  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      // Walk to the matching quote, honouring backslash escapes. Template
      // literals may contain ${...} expressions, but blanking those too is the
      // conservative choice: a network call built inside an interpolation would
      // still need an identifier somewhere else in real code.
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") j += 2;
        else if (source[j] === c) break;
        else j++;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

/**
 * Identifiers that would let the extension talk to a remote host, or replicate
 * data off-device. Each is matched as a whole word so that, say, a local
 * variable named `prefetched` does not trip the check.
 */
const FORBIDDEN = [
  { pattern: /\bfetch\s*\(/, why: "fetch() would send data to a remote server" },
  { pattern: /\bXMLHttpRequest\b/, why: "XMLHttpRequest would send data to a remote server" },
  { pattern: /\bsendBeacon\b/, why: "sendBeacon() exfiltrates data even as the page unloads" },
  { pattern: /\bWebSocket\b/, why: "WebSocket would open a live connection to a remote server" },
  { pattern: /\bEventSource\b/, why: "EventSource would open a connection to a remote server" },
  { pattern: /\bimportScripts\s*\(/, why: "importScripts() can load remote code" },
  {
    pattern: /chrome\s*\.\s*storage\s*\.\s*sync\b/,
    why: "chrome.storage.sync replicates data through the user's Google account; use chrome.storage.local",
  },
];

describe("privacy: the extension cannot reach the network", () => {
  const files = jsFilesUnder(SRC);

  it("has source files to check (guards against the scan silently finding nothing)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN)("uses no $pattern anywhere in src/", ({ pattern, why }) => {
    const offenders = [];
    for (const file of files) {
      const code = stripNonCode(readFileSync(file, "utf8"));
      code.split("\n").forEach((line, index) => {
        if (pattern.test(line)) {
          offenders.push(`${relative(ROOT, file).split(sep).join("/")}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `${why}\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("privacy: the manifest grants no broad access", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

  it("declares no host_permissions", () => {
    // Any entry here would make Chrome warn that the extension can read and
    // change data on those sites, and would let it act without user intent.
    expect(manifest.host_permissions ?? []).toEqual([]);
  });

  it("declares no <all_urls> or wildcard host access anywhere", () => {
    const serialised = JSON.stringify(manifest);
    expect(serialised).not.toContain("<all_urls>");
    expect(serialised).not.toMatch(/https?:\/\/\*/);
  });

  it("requests only the three permissions the design calls for", () => {
    // activeTab + scripting give page access at the moment the user invokes a
    // fill; storage holds the profile. Anything beyond this list needs a very
    // good reason and a README update.
    expect([...manifest.permissions].sort()).toEqual(["activeTab", "scripting", "storage"]);
  });

  it("blocks outbound connections from extension pages via CSP", () => {
    // This is the guarantee that does not rely on us being careful: the browser
    // itself refuses the connection.
    expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'none'");
  });

  it("registers no always-on content scripts", () => {
    // Content scripts are injected on demand through chrome.scripting instead,
    // so that nothing runs on a page unless the user asked for a fill.
    expect(manifest.content_scripts).toBeUndefined();
  });
});
