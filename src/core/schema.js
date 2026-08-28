/**
 * The canonical description of everything JobFill knows how to fill.
 *
 * This file is the single source of truth for three consumers:
 *
 *   1. The options page, which generates its entire editor from these
 *      definitions rather than hand-writing eighty inputs.
 *   2. The matcher, which scores a page's form fields against these keys.
 *   3. docs/FIELD-REFERENCE.md, which is generated from here so the docs cannot
 *      drift out of date.
 *
 * Adding a field therefore means editing this file and nothing else.
 *
 * Pure data and pure functions only — no DOM, no chrome.* APIs. See
 * docs/ARCHITECTURE.md for why that boundary matters.
 */

import { COUNTRIES, US_STATES } from "./data/regions.js";

/**
 * @typedef {"text"|"email"|"tel"|"url"|"date"|"month"|"number"|"textarea"|"select"|"multiselect"|"boolean"|"file"|"tags"} FieldType
 *
 * @typedef {object} FieldDef
 * @property {string} key          Unique within its section. Combined with the
 *                                 section id it forms the canonical path, e.g.
 *                                 `identity.firstName`.
 * @property {string} label        Human label, used in the editor and previews.
 * @property {FieldType} type
 * @property {string} [placeholder]
 * @property {string} [help]       One-line explanation shown under the input.
 * @property {string[]} [options]  Allowed values for select/multiselect.
 * @property {string} [autocomplete] The HTML autocomplete token this field
 *                                 corresponds to. When a page marks an input
 *                                 with the same token, that is an unambiguous
 *                                 match and scores highest of any signal.
 * @property {boolean} [sensitive] Protected-class data. Never filled unless the
 *                                 user turns on the demographics setting.
 * @property {boolean} [derived]   Computed from other fields rather than typed.
 */

/** Reusable option lists, kept here so the same wording is used everywhere. */
const YES_NO = ["Yes", "No"];
const YES_NO_PRIVATE = ["Yes", "No", "Prefer not to say"];

const COUNTRY_NAMES = COUNTRIES.map((c) => c.name);
const US_STATE_NAMES = US_STATES.map((s) => s.name);

/**
 * The sections, in the order they appear in the editor.
 *
 * A section with `repeating: true` stores an array of entries rather than a
 * single object, and its fields describe one entry.
 *
 * @type {Array<{id: string, label: string, description?: string, repeating?: boolean, itemLabel?: string, maxItems?: number, sensitive?: boolean, fields: FieldDef[]}>}
 */
export const SECTIONS = [
  // ---------------------------------------------------------------------------
  {
    id: "identity",
    label: "Identity",
    description: "The name and contact details every application asks for first.",
    fields: [
      { key: "firstName", label: "First name", type: "text", autocomplete: "given-name" },
      { key: "middleName", label: "Middle name", type: "text", autocomplete: "additional-name" },
      { key: "lastName", label: "Last name", type: "text", autocomplete: "family-name" },
      {
        key: "preferredName",
        label: "Preferred name",
        type: "text",
        autocomplete: "nickname",
        help: "What you go by, if it differs from your legal first name.",
      },
      {
        key: "fullName",
        label: "Full name",
        type: "text",
        autocomplete: "name",
        derived: true,
        help: "Filled automatically from your first and last name unless you override it.",
      },
      {
        key: "pronouns",
        label: "Pronouns",
        type: "select",
        options: ["He/Him", "She/Her", "They/Them", "He/They", "She/They", "Prefer not to say"],
      },
      { key: "email", label: "Email", type: "email", autocomplete: "email" },
      {
        key: "phone",
        label: "Phone",
        type: "tel",
        autocomplete: "tel",
        placeholder: "+1 555 123 4567",
        help: "Store it with a country code. JobFill reformats it to match what each form expects.",
      },
      { key: "phoneType", label: "Phone type", type: "select", options: ["Mobile", "Home", "Work"] },
      {
        key: "dateOfBirth",
        label: "Date of birth",
        type: "date",
        autocomplete: "bday",
        help: "Rarely asked outside of some non-US and government applications. Leave blank if you prefer.",
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "address",
    label: "Address",
    description: "Your current mailing address, and how you describe where you live.",
    fields: [
      { key: "line1", label: "Street address", type: "text", autocomplete: "address-line1" },
      { key: "line2", label: "Apartment, suite, etc.", type: "text", autocomplete: "address-line2" },
      { key: "city", label: "City", type: "text", autocomplete: "address-level2" },
      {
        key: "stateProvince",
        label: "State / Province",
        type: "text",
        autocomplete: "address-level1",
        help: "Full name or abbreviation — JobFill converts between them as each form requires.",
        options: US_STATE_NAMES,
      },
      { key: "postalCode", label: "ZIP / Postal code", type: "text", autocomplete: "postal-code" },
      { key: "country", label: "Country", type: "select", options: COUNTRY_NAMES, autocomplete: "country-name" },
      {
        key: "currentLocationText",
        label: "Location, as one line",
        type: "text",
        derived: true,
        placeholder: "Toronto, Ontario, Canada",
        help: 'For forms with a single "Location" box. Built from your city, state and country unless you override it.',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "links",
    label: "Links",
    description: "Profiles and portfolios. Include the full https:// URL.",
    fields: [
      { key: "linkedin", label: "LinkedIn", type: "url", placeholder: "https://linkedin.com/in/…" },
      { key: "github", label: "GitHub", type: "url", placeholder: "https://github.com/…" },
      { key: "portfolio", label: "Portfolio", type: "url" },
      { key: "website", label: "Personal website", type: "url", autocomplete: "url" },
      { key: "twitter", label: "X / Twitter", type: "url" },
      { key: "stackoverflow", label: "Stack Overflow", type: "url" },
      { key: "behance", label: "Behance", type: "url" },
      { key: "dribbble", label: "Dribbble", type: "url" },
      { key: "googleScholar", label: "Google Scholar", type: "url" },
      { key: "otherLink", label: "Other link", type: "url" },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "eligibility",
    label: "Work eligibility",
    description:
      "Standard screening questions. These are filled by default — they are not protected-class data.",
    fields: [
      {
        key: "authorizedToWork",
        label: "Authorised to work in the country of the role",
        type: "select",
        options: YES_NO,
      },
      {
        key: "requiresSponsorship",
        label: "Now or in future requires visa sponsorship",
        type: "select",
        options: YES_NO,
        help: 'Read these carefully on real forms — many phrase it as "will you require sponsorship", which inverts the answer.',
      },
      {
        key: "workAuthType",
        label: "Work authorisation type",
        type: "select",
        options: [
          "Citizen", "Permanent Resident", "Green Card", "H-1B", "H-4 EAD", "F-1 OPT",
          "F-1 STEM OPT", "F-1 CPT", "L-1", "L-2 EAD", "TN", "J-1", "O-1", "E-3",
          "EAD", "Refugee or Asylee", "Requires sponsorship", "Other",
        ],
      },
      { key: "visaStatus", label: "Visa status, in your own words", type: "text" },
      {
        key: "securityClearance",
        label: "Security clearance",
        type: "text",
        placeholder: "None",
        help: 'Write "None" rather than leaving blank, so the field is not skipped.',
      },
      { key: "hasDriversLicense", label: "Holds a driving licence", type: "select", options: YES_NO },
      { key: "over18", label: "Aged 18 or over", type: "select", options: YES_NO },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "preferences",
    label: "Availability & preferences",
    description: "Start date, location flexibility, and compensation expectations.",
    fields: [
      {
        key: "noticePeriod",
        label: "Notice period",
        type: "select",
        options: ["Immediately", "1 week", "2 weeks", "1 month", "2 months", "3 months"],
      },
      { key: "earliestStartDate", label: "Earliest start date", type: "date" },
      { key: "willingToRelocate", label: "Willing to relocate", type: "select", options: YES_NO },
      {
        key: "remotePreference",
        label: "Work arrangement preference",
        type: "select",
        options: ["Remote", "Hybrid", "On-site", "No preference"],
      },
      {
        key: "willingToTravel",
        label: "Willing to travel",
        type: "text",
        placeholder: "Up to 25%",
      },
      {
        key: "desiredSalary",
        label: "Desired salary",
        type: "text",
        placeholder: "120000",
        help: "Store just the number. Some forms reject currency symbols and commas.",
      },
      { key: "currentSalary", label: "Current salary", type: "text" },
      {
        key: "salaryCurrency",
        label: "Currency",
        type: "select",
        options: ["USD", "CAD", "GBP", "EUR", "INR", "AUD", "NZD", "SGD", "CHF", "JPY", "AED"],
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "work",
    label: "Employment history",
    description: "Most recent first. Many forms only ask for the latest one or two.",
    repeating: true,
    itemLabel: "Position",
    maxItems: 12,
    fields: [
      { key: "company", label: "Company", type: "text", autocomplete: "organization" },
      { key: "title", label: "Job title", type: "text", autocomplete: "organization-title" },
      {
        key: "employmentType",
        label: "Employment type",
        type: "select",
        options: ["Full-time", "Part-time", "Contract", "Internship", "Freelance", "Temporary"],
      },
      { key: "location", label: "Location", type: "text", placeholder: "Berlin, Germany" },
      { key: "startDate", label: "Start date", type: "month" },
      { key: "endDate", label: "End date", type: "month", help: "Leave blank if this is your current role." },
      { key: "currentlyWorking", label: "This is my current role", type: "boolean" },
      { key: "description", label: "What you did", type: "textarea" },
      { key: "reasonForLeaving", label: "Reason for leaving", type: "text" },
      {
        key: "supervisorName",
        label: "Manager's name",
        type: "text",
        help: "Asked by background-check style applications, mostly in the US.",
      },
      { key: "supervisorTitle", label: "Manager's title", type: "text" },
      { key: "supervisorContact", label: "Manager's phone or email", type: "text" },
      { key: "mayWeContact", label: "May we contact this employer", type: "select", options: YES_NO },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "education",
    label: "Education",
    description: "Most recent first.",
    repeating: true,
    itemLabel: "Qualification",
    maxItems: 8,
    fields: [
      { key: "school", label: "School or university", type: "text" },
      {
        key: "degree",
        label: "Degree",
        type: "select",
        options: [
          "High School Diploma", "Associate's Degree", "Bachelor's Degree", "Master's Degree",
          "MBA", "Doctorate (PhD)", "Professional Degree (JD, MD)", "Certificate", "Bootcamp", "Other",
        ],
      },
      { key: "fieldOfStudy", label: "Field of study", type: "text", placeholder: "Computer Science" },
      { key: "minor", label: "Minor", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "startDate", label: "Start date", type: "month" },
      { key: "endDate", label: "End date or expected graduation", type: "month" },
      { key: "currentlyAttending", label: "Currently attending", type: "boolean" },
      { key: "gpa", label: "GPA or grade", type: "text", placeholder: "3.8" },
      { key: "gpaScale", label: "Out of", type: "text", placeholder: "4.0" },
      { key: "honors", label: "Honours or awards", type: "text" },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "skills",
    label: "Skills & credentials",
    description: "Used for skills boxes, language questions, and certification lists.",
    fields: [
      {
        key: "skills",
        label: "Skills",
        type: "tags",
        help: "Comma-separated. Filled into skills boxes and used to match skill checkboxes.",
      },
      {
        key: "summary",
        label: "Professional summary",
        type: "textarea",
        help: 'For "tell us about yourself" boxes. Longer answers belong in Snippets.',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "languages",
    label: "Languages",
    repeating: true,
    itemLabel: "Language",
    maxItems: 10,
    fields: [
      { key: "name", label: "Language", type: "text", placeholder: "Gujarati" },
      {
        key: "proficiency",
        label: "Proficiency",
        type: "select",
        options: ["Native or bilingual", "Fluent", "Professional working", "Limited working", "Elementary"],
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "certifications",
    label: "Certifications",
    repeating: true,
    itemLabel: "Certification",
    maxItems: 12,
    fields: [
      { key: "name", label: "Certification", type: "text", placeholder: "AWS Solutions Architect" },
      { key: "issuer", label: "Issuing organisation", type: "text" },
      { key: "issueDate", label: "Issued", type: "month" },
      { key: "expiryDate", label: "Expires", type: "month" },
      { key: "credentialId", label: "Credential ID", type: "text" },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "references",
    label: "References",
    description: "Some applications ask for these up front rather than after an offer.",
    repeating: true,
    itemLabel: "Reference",
    maxItems: 6,
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "relationship", label: "Relationship", type: "text", placeholder: "Former manager" },
      { key: "company", label: "Company", type: "text" },
      { key: "title", label: "Job title", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone", type: "tel" },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "screening",
    label: "Screening questions",
    description: "The miscellaneous questions that appear near the end of most applications.",
    fields: [
      {
        key: "howDidYouHearAboutUs",
        label: "How did you hear about us",
        type: "select",
        options: [
          "Company website", "LinkedIn", "Indeed", "Glassdoor", "Job board",
          "Employee referral", "Recruiter", "University or career fair",
          "Social media", "Friend or colleague", "Other",
        ],
      },
      { key: "referredByName", label: "Referred by", type: "text", help: "The employee who referred you, if any." },
      { key: "previouslyEmployedHere", label: "Previously employed by this company", type: "select", options: YES_NO },
      { key: "relatedToEmployee", label: "Related to a current employee", type: "select", options: YES_NO },
      { key: "appliedBefore", label: "Applied to this company before", type: "select", options: YES_NO },
      { key: "backgroundCheckConsent", label: "Consents to a background check", type: "select", options: YES_NO },
      { key: "drugTestConsent", label: "Consents to a drug test", type: "select", options: YES_NO },
      { key: "nonCompete", label: "Bound by a non-compete", type: "select", options: YES_NO },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "signature",
    label: "Signature & certification",
    description: "The attestation at the bottom of an application form.",
    fields: [
      {
        key: "signatureFullName",
        label: "Typed signature",
        type: "text",
        derived: true,
        help: "Defaults to your full name. Forms ask you to type it to certify the application.",
      },
      { key: "signatureInitials", label: "Initials", type: "text", placeholder: "NR" },
      {
        key: "signatureDate",
        label: "Signature date",
        type: "select",
        options: ["Today's date", "Leave blank"],
        help: 'With "Today\'s date", JobFill fills the current date at the moment you fill the form.',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "demographics",
    label: "Voluntary self-identification",
    sensitive: true,
    description:
      "Protected-class information collected for equal-opportunity reporting. JobFill will not fill any of it " +
      "unless you explicitly turn on the demographics setting, and every answer defaults to " +
      '"Prefer not to say". Answering is voluntary on every form that asks.',
    fields: [
      {
        key: "gender",
        label: "Gender",
        type: "select",
        sensitive: true,
        options: ["Male", "Female", "Non-binary", "Prefer not to say"],
      },
      {
        key: "hispanicOrLatino",
        label: "Hispanic or Latino",
        type: "select",
        sensitive: true,
        options: YES_NO_PRIVATE,
      },
      {
        key: "raceEthnicity",
        label: "Race / ethnicity",
        type: "multiselect",
        sensitive: true,
        // The US EEO-1 categories, which is what nearly every ATS presents.
        options: [
          "American Indian or Alaska Native", "Asian", "Black or African American",
          "Hispanic or Latino", "Native Hawaiian or Other Pacific Islander",
          "White", "Two or More Races", "Prefer not to say",
        ],
      },
      {
        key: "veteranStatus",
        label: "Veteran status",
        type: "select",
        sensitive: true,
        options: [
          "I am not a protected veteran",
          "I identify as one or more of the classifications of a protected veteran",
          "I do not wish to answer",
        ],
      },
      {
        key: "disabilityStatus",
        label: "Disability status",
        type: "select",
        sensitive: true,
        options: [
          "Yes, I have a disability, or have had one in the past",
          "No, I do not have a disability and have not had one in the past",
          "I do not want to answer",
        ],
      },
      {
        key: "sexualOrientation",
        label: "Sexual orientation",
        type: "select",
        sensitive: true,
        options: ["Heterosexual", "Gay or lesbian", "Bisexual", "Other", "Prefer not to say"],
      },
      {
        key: "transgenderIdentity",
        label: "Transgender identity",
        type: "select",
        sensitive: true,
        options: YES_NO_PRIVATE,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  {
    id: "documents",
    label: "Documents",
    description:
      "Stored in this extension's local database and attached to file uploads. They are read only to " +
      "attach to a page you opened, and never leave your computer.",
    fields: [
      { key: "resume", label: "Resume / CV", type: "file" },
      { key: "coverLetterFile", label: "Cover letter", type: "file" },
      { key: "transcript", label: "Transcript", type: "file" },
      { key: "portfolioFile", label: "Portfolio", type: "file" },
      { key: "writingSample", label: "Writing sample", type: "file" },
      {
        key: "coverLetterText",
        label: "Cover letter, as text",
        type: "textarea",
        help: "For forms with a cover letter textarea instead of a file upload.",
      },
    ],
  },
];

/**
 * Questions JobFill deliberately refuses to answer automatically.
 *
 * Criminal history wording varies by jurisdiction in ways that change the
 * correct answer — "convicted" versus "arrested", spent convictions, sealed
 * records, ban-the-box states. A confidently wrong auto-answer on a submitted
 * application is materially worse than an empty box, so the matcher reports
 * these as skipped and leaves them to the applicant.
 */
export const NEVER_AUTOFILL = [
  "criminal record", "criminal history", "convicted", "conviction", "felony",
  "misdemeanor", "arrested", "pleaded guilty", "plead guilty", "background check history",
];

// ---------------------------------------------------------------------------
// Derived lookups. Built once at module load, since SECTIONS never changes.
// ---------------------------------------------------------------------------

/** Every field, flattened, each tagged with the section it came from. */
export const ALL_FIELDS = SECTIONS.flatMap((section) =>
  section.fields.map((field) => ({
    ...field,
    sectionId: section.id,
    /** Canonical dotted path, e.g. "identity.firstName" or "work.company". */
    path: `${section.id}.${field.key}`,
    repeating: Boolean(section.repeating),
    // A field is sensitive if it says so, or if its whole section is.
    sensitive: Boolean(field.sensitive || section.sensitive),
  }))
);

/** @type {Map<string, typeof ALL_FIELDS[number]>} path -> field definition. */
export const FIELD_BY_PATH = new Map(ALL_FIELDS.map((f) => [f.path, f]));

/** @type {Map<string, typeof SECTIONS[number]>} id -> section definition. */
export const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

/**
 * Resolve a field definition from a path, tolerating an index segment.
 *
 * Repeating fields are stored per-entry ("work.2.company") but defined once
 * ("work.company"), so callers holding a concrete path can look up the
 * definition without stripping the index themselves.
 *
 * @param {string} path e.g. "identity.email", "work.2.company"
 */
export function getField(path) {
  return FIELD_BY_PATH.get(path) ?? FIELD_BY_PATH.get(path.replace(/\.\d+\./, "."));
}

/**
 * Split a stored path into its parts.
 * @param {string} path
 * @returns {{sectionId: string, index: number|null, key: string}}
 */
export function parsePath(path) {
  const parts = String(path).split(".");
  if (parts.length === 3) {
    return { sectionId: parts[0], index: Number(parts[1]), key: parts[2] };
  }
  return { sectionId: parts[0], index: null, key: parts[1] };
}
