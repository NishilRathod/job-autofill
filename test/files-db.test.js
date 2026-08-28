/**
 * Document validation.
 *
 * Only the pure helpers are covered here. The IndexedDB read/write path needs a
 * real database and is verified by hand in the options page — jsdom has no
 * IndexedDB, and a shim would test the shim rather than the browser.
 *
 * Validation is the part worth testing anyway: it is what stops a 40 MB file or
 * a `.exe` from being stored and then silently failing at fill time, on a form
 * the user is about to submit.
 */

import { describe, it, expect } from "vitest";
import {
  validateFile,
  formatBytes,
  MAX_FILE_BYTES,
  ALLOWED_EXTENSIONS,
} from "../src/storage/files-db.js";

/** A stand-in for a File: validateFile only reads name, size and type. */
const fakeFile = (name, size, type = "") => ({ name, size, type });

describe("validateFile", () => {
  it("accepts an ordinary resume", () => {
    expect(validateFile(fakeFile("Nishil_Rathod_Resume.pdf", 240_000, "application/pdf"))).toBeNull();
  });

  it.each(ALLOWED_EXTENSIONS)("accepts %s", (extension) => {
    expect(validateFile(fakeFile(`resume${extension}`, 1000))).toBeNull();
  });

  it("matches the extension case-insensitively", () => {
    // Windows in particular hands over "Resume.PDF" often enough to matter.
    expect(validateFile(fakeFile("Resume.PDF", 1000))).toBeNull();
    expect(validateFile(fakeFile("Resume.DocX", 1000))).toBeNull();
  });

  it.each(["resume.exe", "resume.zip", "resume.js", "resume"])("rejects %s", (name) => {
    expect(validateFile(fakeFile(name, 1000))).toMatch(/not accepted/i);
  });

  it("rejects a file over the size limit and says how big it was", () => {
    const message = validateFile(fakeFile("huge.pdf", MAX_FILE_BYTES + 1));
    expect(message).toMatch(/10 MB/);
    expect(message).toMatch(/10\.0 MB/); // the actual size, so the error is actionable
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateFile(fakeFile("edge.pdf", MAX_FILE_BYTES))).toBeNull();
  });

  it("rejects an empty file", () => {
    // A zero-byte upload attaches successfully and fails review silently, which
    // is the worst possible outcome.
    expect(validateFile(fakeFile("empty.pdf", 0))).toMatch(/empty/i);
  });

  it("rejects nothing at all", () => {
    expect(validateFile(null)).toMatch(/no file/i);
    expect(validateFile(undefined)).toMatch(/no file/i);
  });

  it("uses the last extension in a multi-dotted name", () => {
    expect(validateFile(fakeFile("resume.v2.final.pdf", 1000))).toBeNull();
    expect(validateFile(fakeFile("resume.pdf.exe", 1000))).toMatch(/not accepted/i);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1 KB"],
    [240_000, "234 KB"],
    [1024 * 1024, "1.0 MB"],
    [2_621_440, "2.5 MB"],
  ])("%i -> %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
