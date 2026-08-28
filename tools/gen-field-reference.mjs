/**
 * Generates docs/FIELD-REFERENCE.md from src/core/schema.js.
 *
 * schema.js claims to be the single source of truth for what JobFill can fill.
 * Hand-maintained documentation would quietly falsify that claim within a few
 * commits, so the reference is generated instead — and a test asserts the
 * committed file matches what this script produces, which turns "the docs are
 * stale" into a failing build.
 *
 * Run with `npm run docs`.
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SECTIONS, ALL_FIELDS, NEVER_AUTOFILL } from "../src/core/schema.js";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "FIELD-REFERENCE.md");

/** Escape pipes so option lists do not break the markdown table. */
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|");

/** Render a field's accepted values, truncated when a list is unhelpfully long. */
function describeValues(field) {
  if (field.options?.length) {
    // Country and state lists run to hundreds of entries; showing them all
    // would bury the actual reference material.
    if (field.options.length > 12) {
      return `one of ${field.options.length} options (${cell(field.options.slice(0, 3).join(", "))}, …)`;
    }
    return field.options.map((o) => `\`${cell(o)}\``).join(", ");
  }
  switch (field.type) {
    case "boolean": return "yes / no";
    case "tags": return "comma-separated list";
    case "file": return "an uploaded file";
    case "month": return "`YYYY-MM`";
    case "date": return "`YYYY-MM-DD`";
    default: return "free text";
  }
}

function build() {
  const lines = [];

  lines.push("# Field reference");
  lines.push("");
  lines.push(
    "Everything JobFill can store and fill. **This file is generated** from",
    "[`src/core/schema.js`](../src/core/schema.js) by `npm run docs` — edit the schema, not this file."
  );
  lines.push("");
  lines.push(
    `There are **${ALL_FIELDS.length} fields** across **${SECTIONS.length} sections**. ` +
    "You do not need to fill them all in; JobFill skips anything you leave blank."
  );
  lines.push("");
  lines.push("Each field has a canonical path like `identity.firstName`. Sections marked");
  lines.push("**repeating** store a list, and their paths carry an index: `work.0.company`.");
  lines.push("");

  // Contents, because 105 fields is a lot to scroll blindly.
  lines.push("## Sections");
  lines.push("");
  for (const section of SECTIONS) {
    const flags = [
      section.repeating ? "repeating" : null,
      section.sensitive ? "**opt-in**" : null,
    ].filter(Boolean);
    const suffix = flags.length ? ` — ${flags.join(", ")}` : "";
    lines.push(`- [${section.label}](#${section.id}) · \`${section.id}\` · ${section.fields.length} fields${suffix}`);
  }
  lines.push("");

  for (const section of SECTIONS) {
    lines.push("---");
    lines.push("");
    lines.push(`## ${section.label}`);
    lines.push("");
    lines.push(`<a id="${section.id}"></a>`);
    lines.push("");

    if (section.description) {
      lines.push(section.description);
      lines.push("");
    }

    if (section.repeating) {
      lines.push(
        `> **Repeating section.** Holds up to ${section.maxItems} entries, each one a ` +
        `"${section.itemLabel}". Paths include the entry index, e.g. \`${section.id}.0.${section.fields[0].key}\`.`
      );
      lines.push("");
    }

    if (section.sensitive) {
      lines.push(
        "> **Opt-in.** JobFill never fills these unless you turn on the demographics",
        "> setting. Every answer defaults to declining to answer."
      );
      lines.push("");
    }

    lines.push("| Field | Path | Accepts | Notes |");
    lines.push("| --- | --- | --- | --- |");
    for (const field of section.fields) {
      const notes = [
        field.help,
        field.derived ? "Filled automatically from other fields unless you override it." : null,
        field.autocomplete ? `Maps to the HTML \`${field.autocomplete}\` autocomplete token.` : null,
      ].filter(Boolean).join(" ");

      lines.push(
        `| ${cell(field.label)} | \`${section.id}.${field.key}\` | ${describeValues(field)} | ${cell(notes)} |`
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Questions JobFill will not answer");
  lines.push("");
  lines.push(
    "Criminal-history questions are deliberately left blank. Their wording varies by",
    "jurisdiction in ways that change the correct answer — *convicted* versus *arrested*,",
    "spent convictions, sealed records, ban-the-box rules — and a confidently wrong",
    "auto-answer on a submitted application is far worse than an empty box. JobFill",
    "reports these as skipped so you answer them yourself."
  );
  lines.push("");
  lines.push("Detected by these phrases:");
  lines.push("");
  lines.push(NEVER_AUTOFILL.map((p) => `\`${p}\``).join(" · "));
  lines.push("");

  return lines.join("\n");
}

export { build };

// Only write when run as a script. The staleness test imports `build` from
// here, and if importing also rewrote the file, the test would be checking the
// file against itself and could never fail.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  writeFileSync(OUT, build(), "utf8");
  console.log(`wrote docs/FIELD-REFERENCE.md (${ALL_FIELDS.length} fields)`);
}
