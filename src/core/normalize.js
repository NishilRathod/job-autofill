/**
 * Text normalisation for field matching.
 *
 * Form authors name things in every convention there is: `firstName`,
 * `first_name`, `FIRST-NAME`, `applicant[first_name]`, `txtFName`,
 * `job_application_answers_attributes_0_text_value`. Matching is only tractable
 * once all of that collapses to the same token stream.
 *
 * Pure functions, no DOM. Everything here is called once per field per scan, so
 * the shared caches matter on a Workday page with three hundred inputs.
 */

/**
 * Strip a string to comparable text: lowercase, unaccented, punctuation gone,
 * whitespace collapsed.
 *
 * Accents are folded because a form may label a field "Prénom" while a rule
 * spells it "prenom", and neither author is wrong.
 */
export function deaccent(input) {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, ""); // combining marks left behind by NFKD
}

export function normalizeText(input) {
  return deaccent(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Words that carry no signal about which field this is.
 *
 * Dropping them is what lets "Please enter your first name *" match a rule
 * written as "first name". Kept deliberately short: every word removed here is
 * a word that can no longer disambiguate anything.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "your", "you", "please", "enter", "provide",
  "select", "choose", "is", "are", "of", "for", "to", "in", "on", "at",
  "this", "that", "required", "optional", "value", "input",
]);

// Words that look like noise but carry meaning in this domain, and so must
// never be added above. "type" appears in "employment type", "visa type" and
// "phone type"; "field" in "field of study". Dropping either silently truncates
// a two-word rule to one generic word — "job type" becomes "job", which then
// matches any form field whose name merely contains "job".

/**
 * Abbreviations and alternate spellings, mapped to the words rules are written
 * in. Expansion happens after tokenising, so `txtFName` becomes
 * ["txt", "f", "name"] then ["first", "name"].
 */
const SYNONYMS = new Map(Object.entries({
  fname: "first name",
  firstname: "first name",
  givenname: "first name",
  given: "first",
  forename: "first name",
  lname: "last name",
  lastname: "last name",
  surname: "last name",
  familyname: "last name",
  family: "last",
  mname: "middle name",
  middlename: "middle name",
  fullname: "full name",
  nickname: "preferred name",
  mail: "email",
  emailaddress: "email",
  mobile: "phone",
  cell: "phone",
  cellphone: "phone",
  telephone: "phone",
  tel: "phone",
  phonenumber: "phone number",
  zip: "postal",
  zipcode: "postal code",
  postcode: "postal code",
  addr: "address",
  street: "address",
  province: "state",
  region: "state",
  county: "state",
  dob: "date of birth",
  birthday: "date of birth",
  birthdate: "date of birth",
  cv: "resume",
  curriculumvitae: "resume",
  employer: "company",
  organisation: "company",
  organization: "company",
  org: "company",
  position: "title",
  jobtitle: "job title",
  role: "title",
  school: "school",
  university: "school",
  college: "school",
  institution: "school",
  uni: "school",
  major: "field of study",
  degreelevel: "degree",
  gpa: "gpa",
  grade: "gpa",
  linkedinurl: "linkedin",
  githuburl: "github",
  website: "website",
  url: "website",
  homepage: "website",
  portfolio: "portfolio",
  salary: "salary",
  compensation: "salary",
  pay: "salary",
  ctc: "salary",
  visa: "visa",
  sponsorship: "sponsorship",
  authorisation: "authorization",
  authorised: "authorized",
  relocate: "relocation",
  noticeperiod: "notice period",
  startdate: "start date",
  availability: "start date",
  gender: "gender",
  ethnicity: "race",
  raceethnicity: "race",
  veteran: "veteran",
  disability: "disability",
  // Very common vendor prefixes that carry no meaning. Mapping them to an
  // empty string removes them without them having to be stop words, which
  // would also drop them from label text where they might matter.
  txt: "",
  fld: "",
  inp: "",
  ctl: "",
  frm: "",
}));

/**
 * Split an identifier or phrase into meaningful tokens.
 *
 * Handles camelCase, PascalCase, snake_case, kebab-case, dotted paths, and
 * bracketed Rails-style names, then expands abbreviations and drops stop words.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function tokenize(input) {
  // A leading vendor prefix carries no meaning. It has to go before the
  // camelCase split, otherwise "txtFName" becomes txt|F|Name and the "fname"
  // abbreviation never gets a chance to fire.
  //
  // Two passes, because the prefix must be followed by either a separator or a
  // capital — otherwise "inputEmail" is read as "inp" + "utEmail". The
  // camelCase pass has to stay case-sensitive for that lookahead to mean
  // anything, which is why it cannot be folded into the first regex.
  const stripped = deaccent(input)
    .replace(/^(?:txt|fld|inp|ctl|frm|input|field)[_\-\s]/i, "")
    .replace(/^(?:txt|fld|inp|ctl|frm|input|field)(?=[A-Z])/, "");

  const tokens = [];

  /** Expand through the synonym table and keep whatever survives. */
  const push = (word) => {
    for (const part of (SYNONYMS.get(word) ?? word).split(" ")) {
      // Single letters are always debris — the "e" left by splitting "e-mail",
      // or an initial from a mangled prefix. None of them identify a field.
      if (part.length >= 2 && !STOP_WORDS.has(part)) tokens.push(part);
    }
  };

  // Separators first; each chunk may still be camelCase inside.
  for (const chunk of stripped.split(/[^A-Za-z0-9]+/)) {
    if (!chunk) continue;

    // Try the chunk whole before splitting it. "FName" is a known abbreviation,
    // but camel-splitting it to "F" + "Name" destroys that, and "F" is then
    // discarded as debris — losing the only clue that this is a first name.
    const whole = chunk.toLowerCase();
    if (SYNONYMS.has(whole)) {
      push(whole);
      continue;
    }

    const split = chunk
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

    for (const word of normalizeText(split).split(" ")) {
      // Pure digits are index noise from repeated sections
      // ("education_1_school"), not identity.
      if (word && !/^\d+$/.test(word)) push(word);
    }
  }

  return tokens;
}

/**
 * Normalised phrase form: tokens rejoined with single spaces.
 *
 * This is what phrase rules compare against, so "Legal First Name *" and
 * "legal_first_name" both reduce to "legal first name".
 */
export function toPhrase(input) {
  return tokenize(input).join(" ");
}

/**
 * How much of `needle`'s tokens appear in `haystack`, from 0 to 1.
 *
 * Asymmetric on purpose. A rule for "first name" should score highly against a
 * label of "Applicant legal first name", because every word the rule cares
 * about is present. Scoring by overlap in both directions would penalise the
 * rule for the label's extra words, which is backwards — long labels are the
 * norm on application forms.
 */
export function tokenCoverage(needleTokens, haystackTokens) {
  if (!needleTokens.length) return 0;
  const haystack = new Set(haystackTokens);
  let hits = 0;
  for (const token of needleTokens) if (haystack.has(token)) hits += 1;
  return hits / needleTokens.length;
}

/**
 * Every text part of a descriptor, tokenised once.
 *
 * The single source of truth for "what words are attached to this field". It
 * lives here rather than in the matcher because two callers need to agree on
 * it exactly: the scorer, which decides what a field is, and the veto check,
 * which decides what it must not be. When those two disagreed — `allTokens`
 * once omitted the wrapping-element names that the scorer was happily matching
 * on — a field wrapped in `emergencyContactPhone` scored well enough to be
 * filled while the "emergency" veto never saw the word that should have
 * blocked it. Any new signal added to `parts` is therefore automatically
 * covered by the vetoes too.
 *
 * @param {object} descriptor
 * @returns {{label: string[], name: string[], placeholder: string[],
 *   ancestor: string[], context: string[], all: string[]}}
 */
export function descriptorTokens(descriptor) {
  // `||` rather than `??`: an unlabelled field has label "", not undefined, and
  // a nullish check would never reach any of the fallbacks.
  const labelText =
    descriptor.label || descriptor.ariaLabel || descriptor.titleAttr || descriptor.describedBy || "";

  // The control's own vendor attribute belongs with its name: both are the
  // form author naming this exact field.
  const label = tokenize(labelText);
  const name = tokenize(`${descriptor.name ?? ""} ${descriptor.id ?? ""} ${descriptor.automationId ?? ""}`);
  const placeholder = tokenize(descriptor.placeholder ?? "");
  const ancestor = tokenize((descriptor.ancestorIds ?? []).join(" "));
  const context = tokenize(descriptor.sectionText ?? "");

  return {
    label,
    name,
    placeholder,
    ancestor,
    context,
    all: [...label, ...name, ...placeholder, ...ancestor, ...context],
  };
}

/**
 * A stable identity for a form field, used as the key for learned mappings.
 *
 * Digits are collapsed to `#` so that a field which is `answers[3][value]` on
 * one posting and `answers[7][value]` on the next is recognised as the same
 * field. Label text is included because vendor-generated ids are often random
 * per page load, leaving the label as the only durable part.
 *
 * @param {{name?: string, id?: string, type?: string, label?: string}} descriptor
 * @returns {string}
 */
export function signatureOf(descriptor) {
  const stable = (value) => normalizeText(value).replace(/\d+/g, "#");
  return [
    descriptor.type ?? "",
    stable(descriptor.name),
    stable(descriptor.id),
    stable(descriptor.label),
  ].join("|");
}
