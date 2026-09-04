/**
 * Adapters for the applicant tracking systems people actually apply through.
 *
 * An adapter is a URL pattern plus a map of attribute patterns to canonical
 * field paths. Nothing here touches the DOM: the patterns are matched against
 * the `name`, `id`, vendor attributes and wrapping-element ids the collector
 * already recorded, which is what keeps adapters testable with plain objects
 * and cheap to maintain.
 *
 * Adapters exist for the fields the generic engine gets *wrong*, not for every
 * field. Greenhouse labels its name fields perfectly well and the heuristics
 * handle them; what the heuristics cannot handle is Workday's
 * `data-automation-id` naming, or a field whose only distinguishing feature is
 * a vendor-specific attribute. Every entry below should be justifiable that
 * way — a bloated adapter is one that breaks on the vendor's next redesign.
 *
 * Two kinds of pattern, both case-insensitive regular expressions:
 *
 *   - `selectors` are tested against the field's name, id, vendor attribute and
 *     the ids of its wrapping elements, joined together.
 *   - `questions` are tested against the *resolved label*. They exist for sites
 *     whose attribute names carry no meaning whatsoever — Lever's
 *     `cards[<uuid>][field7]`, Zoho's `rec-form_<digits>` — where the rendered
 *     question is the only thing identifying a field. Prefer `selectors`:
 *     labels are localised and re-worded, attributes usually are not.
 */

/** @type {Array<{name: string, match: RegExp, selectors?: Record<string,string>, questions?: Record<string,string>}>} */
export const ATS_ADAPTERS = [


// ---------------------------------------------------------------------------
// Workday — by far the most valuable adapter.
//
// Workday renders dropdowns as buttons and names everything through
// data-automation-id, which is far more stable than the visible label — that is
// localised and re-worded between tenants.
//
// The patterns below match against wrapping elements as well as the control
// itself, which is how Workday is actually built: the div around the input
// carries `formField-<section>--<field>`. Tenants differ on whether the
// separator is "_" or "--", so every pattern accepts both.
//
// Partly verified against workday.wd5.myworkdayjobs.com. Confirmed there: the
// `formField-<name>` wrapper convention, generated `input-N` ids, and an empty
// `name` on every control. Also confirmed, and contrary to what this comment
// used to claim: that tenant *does* associate labels with `for`, so the sibling
// scan is a fallback on Workday rather than the only route.
//
// The apply flow itself sits behind account creation, so the field names below
// — legalNameSection, addressSection, workExperience — are still unverified
// against a live form. test/fixtures/workday.html reproduces the shape they
// assume; test/fixtures/workday-signin.html is copied from the real page.
// ---------------------------------------------------------------------------
{
  name: "Workday",
  match: /\.myworkdayjobs\.com|\.workday\.com/i,
  selectors: {
    "legalNameSection[-_]+firstName": "identity.firstName",
    "legalNameSection[-_]+lastName": "identity.lastName",
    "legalNameSection[-_]+middleName": "identity.middleName",
    "preferredNameSection[-_]+firstName": "identity.preferredName",
    "\\bemail\\b(?!.*confirm)": "identity.email",
    "phone-?number|phoneNumber": "identity.phone",
    "addressSection[-_]+addressLine1": "address.line1",
    "addressSection[-_]+addressLine2": "address.line2",
    "addressSection[-_]+city": "address.city",
    "addressSection[-_]+countryRegion": "address.stateProvince",
    "addressSection[-_]+postalCode": "address.postalCode",
    "addressSection[-_]+country(?!Region)": "address.country",
    "workExperience.*jobTitle": "work.title",
    "workExperience.*company": "work.company",
    "education.*schoolName|educationSection.*school": "education.school",
    "education.*degree": "education.degree",
    "education.*fieldOfStudy": "education.fieldOfStudy",
    "source--source|howDidYouHear": "screening.howDidYouHearAboutUs",
    // Deliberately not `file-upload-input-ref`, which Workday reuses for every
    // attachment on the page including the cover letter.
    "resumeAttachments": "documents.resume",
  },
},

// ---------------------------------------------------------------------------
// Greenhouse — well-built forms, so this is deliberately thin.
//
// Only the URL fields need help: they are named job_application[urls][LinkedIn]
// and their visible labels are sometimes just "LinkedIn" with no context.
// ---------------------------------------------------------------------------
{
  name: "Greenhouse",
  match: /greenhouse\.io|boards\.greenhouse\.io|job-boards\.greenhouse\.io/i,
  selectors: {
    "urls.*linkedin": "links.linkedin",
    "urls.*github": "links.github",
    "urls.*portfolio": "links.portfolio",
    "urls.*website|urls.*other": "links.website",
    "job_application\\[resume\\]|\\bresume\\b": "documents.resume",
    "cover_letter": "documents.coverLetterFile",
  },
},

// ---------------------------------------------------------------------------
// Lever — names its built-in fields plainly, but its custom questions not at
// all: they arrive as cards[<uuid>][field7], where the uuid changes with every
// posting and the index means nothing. Those need `questions`.
//
// "org" reads as an employer name to the heuristics, but Lever means the
// applicant's current company.
// ---------------------------------------------------------------------------
{
  name: "Lever",
  match: /jobs\.lever\.co|hire\.lever\.co/i,
  selectors: {
    "\\borg\\b|\\borg-input\\b": "work.company",
    "urls\\[LinkedIn\\]|linkedin": "links.linkedin",
    "urls\\[GitHub\\]|github": "links.github",
    "urls\\[Portfolio\\]|portfolio": "links.portfolio",
    "urls\\[Other\\]": "links.otherLink",
    "\\bresume\\b|resume-upload-input|input-resume": "documents.resume",
    "\\bname-input\\b": "identity.fullName",
    "\\bemail-input\\b": "identity.email",
    "\\bphone-input\\b": "identity.phone",
    "structured-contact-location-question|\\blocation-input\\b": "address.currentLocationText",
  },
  questions: {
    "how did you hear about": "screening.howDidYouHearAboutUs",
    "who referred you|referred you to this": "screening.referredByName",
    "current .*(salary|compensation)": "preferences.currentSalary",
    "(expected|desired) .*(salary|compensation)": "preferences.desiredSalary",
    "earliest start date|when can you start": "preferences.earliestStartDate",
    "notice period": "preferences.noticePeriod",
    "linkedin profile": "links.linkedin",
  },
},

// ---------------------------------------------------------------------------
// Zoho Recruit — the case that makes `questions` necessary.
//
// Every field is named `rec-form_<18 digits>`, an internal record id that
// differs in every tenant and carries no meaning at all. Tokenised, the whole
// page reduces to "rec form", so selectors are worthless here and the visible
// label is the only thing identifying a field.
//
// Zoho renders with its own Lyte component library, which stacks six wrappers
// between an input and its <label> and parks a currency symbol nearer to the
// salary boxes than their real label. The label ranking in
// src/content/collect.js is what makes these questions resolvable at all.
// ---------------------------------------------------------------------------
{
  name: "Zoho Recruit",
  match: /zohorecruit\.(com|in|eu|jp|com\.au|uk)|recruit\.zoho\./i,
  // No selectors at all, and that is the point: there is no attribute on a Zoho
  // form worth matching. The only other stably-named control is the "autofill
  // from resume" parser at the top of the page, and it is deliberately left
  // alone — attaching there feeds Zoho's own parser instead of filling the
  // required Resume field further down, which would look like success and
  // submit an application with no resume on it.
  questions: {
    "^first name": "identity.firstName",
    "^last name": "identity.lastName",
    "^email": "identity.email",
    "^mobile|^phone": "identity.phone",
    "^city": "address.city",
    "^state\\s*/?\\s*province|^state\\b": "address.stateProvince",
    "^country": "address.country",
    "^street|^address": "address.line1",
    "^zip|^postal": "address.postalCode",
    "^current employer": "work.company",
    "^current job title|^job title": "work.title",
    "^current salary": "preferences.currentSalary",
    "^expected salary": "preferences.desiredSalary",
    "^notice period": "preferences.noticePeriod",
    "^highest qualification": "education.degree",
    "^skill ?set|^skills": "skills.skills",
    "earliest available date of joining|^date of joining": "preferences.earliestStartDate",
    "^linkedin": "links.linkedin",
    "^resume|^cv\\b": "documents.resume",
    "^cover letter": "documents.coverLetterFile",
  },
},

// ---------------------------------------------------------------------------
// Ashby — React-based, with generated field ids. The stable part is the
// _systemfield_ naming.
// ---------------------------------------------------------------------------
{
  name: "Ashby",
  match: /jobs\.ashbyhq\.com|ashbyhq\.com/i,
  selectors: {
    "_systemfield_name": "identity.fullName",
    "_systemfield_email": "identity.email",
    "_systemfield_phone": "identity.phone",
    "_systemfield_resume": "documents.resume",
    "_systemfield_location": "address.currentLocationText",
    "linkedin": "links.linkedin",
    "github": "links.github",
  },
},

// ---------------------------------------------------------------------------
// Workable
// ---------------------------------------------------------------------------
{
  name: "Workable",
  match: /apply\.workable\.com|workable\.com/i,
  selectors: {
    "\\bfirstname\\b": "identity.firstName",
    "\\blastname\\b": "identity.lastName",
    "\\bemail\\b": "identity.email",
    "\\bphone\\b": "identity.phone",
    "\\bresume\\b": "documents.resume",
    "\\bcover_letter\\b|coverletter": "documents.coverLetterText",
    "\\bsummary\\b": "skills.summary",
    "linkedin": "links.linkedin",
  },
},

// ---------------------------------------------------------------------------
// SmartRecruiters
// ---------------------------------------------------------------------------
{
  name: "SmartRecruiters",
  match: /jobs\.smartrecruiters\.com|smartrecruiters\.com/i,
  selectors: {
    "firstName": "identity.firstName",
    "lastName": "identity.lastName",
    "\\bemail\\b": "identity.email",
    "phoneNumber": "identity.phone",
    "location\\.city|\\bcity\\b": "address.city",
    "location\\.country|\\bcountry\\b": "address.country",
    "web\\.linkedin|linkedin": "links.linkedin",
    "web\\.website|\\bwebsite\\b": "links.website",
    "\\bresume\\b|attachment": "documents.resume",
  },
},

// ---------------------------------------------------------------------------
// iCIMS — older, frame-heavy, and names everything with a numeric suffix that
// changes between postings. Only the stable prefixes are worth listing.
// ---------------------------------------------------------------------------
{
  name: "iCIMS",
  match: /icims\.com/i,
  selectors: {
    "fields\\[\\d+\\]\\.firstname|\\bfirstname\\b": "identity.firstName",
    "fields\\[\\d+\\]\\.lastname|\\blastname\\b": "identity.lastName",
    "fields\\[\\d+\\]\\.email|\\bemail\\b": "identity.email",
    "\\bphone\\b|homephone": "identity.phone",
    "\\baddressstreet\\b|addr1": "address.line1",
    "\\baddresscity\\b": "address.city",
    "\\baddresszip\\b|postalcode": "address.postalCode",
    "\\bresume\\b": "documents.resume",
  },
},

// ---------------------------------------------------------------------------
// Taleo — Oracle's, and the oldest markup of the lot. Field ids look like
// "requisition.candidate.firstName" or are entirely generated.
// ---------------------------------------------------------------------------
{
  name: "Taleo",
  match: /taleo\.net|tbe\.taleo\.net/i,
  selectors: {
    "candidate\\.firstName|\\bfirstName\\b": "identity.firstName",
    "candidate\\.lastName|\\blastName\\b": "identity.lastName",
    "candidate\\.email|\\bemail\\b": "identity.email",
    "candidate\\.cellPhone|candidate\\.homePhone": "identity.phone",
    "candidate\\.address": "address.line1",
    "candidate\\.city": "address.city",
    "candidate\\.zipCode": "address.postalCode",
  },
},

// ---------------------------------------------------------------------------
// BambooHR
// ---------------------------------------------------------------------------
{
  name: "BambooHR",
  match: /bamboohr\.com/i,
  selectors: {
    "\\bfirstName\\b": "identity.firstName",
    "\\blastName\\b": "identity.lastName",
    "\\bemail\\b": "identity.email",
    "\\bphone\\b": "identity.phone",
    "\\bresume\\b": "documents.resume",
    "\\bwebsite\\b": "links.website",
    "linkedinUrl|linkedin": "links.linkedin",
  },
},

// ---------------------------------------------------------------------------
// Rippling, Pinpoint and Teamtailor share a plain naming convention, so one
// pattern set serves all three.
// ---------------------------------------------------------------------------
{
  name: "Rippling / Pinpoint / Teamtailor",
  match: /ats\.rippling\.com|pinpointhq\.com|teamtailor\.com/i,
  selectors: {
    "first[_-]?name": "identity.firstName",
    "last[_-]?name": "identity.lastName",
    "\\bemail\\b": "identity.email",
    "\\bphone\\b": "identity.phone",
    "\\bresume\\b|\\bcv\\b": "documents.resume",
    "linkedin": "links.linkedin",
  },
},
];
