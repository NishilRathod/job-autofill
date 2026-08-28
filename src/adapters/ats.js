/**
 * Adapters for the applicant tracking systems people actually apply through.
 *
 * An adapter is a URL pattern plus a map of attribute patterns to canonical
 * field paths. Nothing here touches the DOM: the patterns are matched against
 * the `name`, `id` and vendor attributes the collector already recorded, which
 * is what keeps adapters testable with plain objects and cheap to maintain.
 *
 * Adapters exist for the fields the generic engine gets *wrong*, not for every
 * field. Greenhouse labels its name fields perfectly well and the heuristics
 * handle them; what the heuristics cannot handle is Workday's
 * `data-automation-id` naming, or a field whose only distinguishing feature is
 * a vendor-specific attribute. Every entry below should be justifiable that
 * way — a bloated adapter is one that breaks on the vendor's next redesign.
 *
 * Patterns are case-insensitive regular expressions, tested against a string of
 * the field's name, id and automation id joined together.
 */

/** @type {Array<{name: string, match: RegExp, selectors: Record<string,string>}>} */
export const ATS_ADAPTERS = [


// ---------------------------------------------------------------------------
// Workday — by far the most valuable adapter.
//
// Workday associates no labels, renders dropdowns as buttons, and names
// everything through data-automation-id. The generic engine copes because the
// collector reads sibling text as a label, but the automation ids are far more
// stable than that text, which is localised and re-worded between tenants.
// ---------------------------------------------------------------------------
{
  name: "Workday",
  match: /\.myworkdayjobs\.com|\.workday\.com/i,
  selectors: {
    "legalNameSection_firstName": "identity.firstName",
    "legalNameSection_lastName": "identity.lastName",
    "legalNameSection_middleName": "identity.middleName",
    "preferredNameSection_firstName": "identity.preferredName",
    "\\bemail\\b(?!.*confirm)": "identity.email",
    "phone-?number|phoneNumber": "identity.phone",
    "addressSection_addressLine1": "address.line1",
    "addressSection_addressLine2": "address.line2",
    "addressSection_city": "address.city",
    "addressSection_countryRegion": "address.stateProvince",
    "addressSection_postalCode": "address.postalCode",
    "addressSection_country(?!Region)": "address.country",
    "workExperience.*jobTitle": "work.title",
    "workExperience.*company": "work.company",
    "education.*schoolName|educationSection.*school": "education.school",
    "education.*degree": "education.degree",
    "education.*fieldOfStudy": "education.fieldOfStudy",
    "source--source|howDidYouHear": "screening.howDidYouHearAboutUs",
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
// Lever — names fields plainly, so only the org/links need disambiguating.
// "org" reads as an employer name to the heuristics, but Lever means the
// applicant's current company.
// ---------------------------------------------------------------------------
{
  name: "Lever",
  match: /jobs\.lever\.co|hire\.lever\.co/i,
  selectors: {
    "\\borg\\b": "work.company",
    "urls\\[LinkedIn\\]|linkedin": "links.linkedin",
    "urls\\[GitHub\\]|github": "links.github",
    "urls\\[Portfolio\\]|portfolio": "links.portfolio",
    "urls\\[Other\\]": "links.otherLink",
    "\\bresume\\b": "documents.resume",
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
