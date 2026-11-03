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
 *
 * Two things about these patterns are not standard regex behaviour, both
 * implemented in index.js:
 *
 *   - **`\b` means a separator boundary, not a word boundary.** An underscore
 *     is a word character, so a literal `\b` matches "address--city" and
 *     "address.city" but silently fails on "address_city" — and snake_case is
 *     the commonest convention there is. `compilePattern` translates it. Use
 *     `\b` freely; spell out a lookaround only for an asymmetric guard.
 *   - **A hint still yields to the path's vetoes.** `email` and `phone` are
 *     generic enough to hit "confirm_email" and "emergency_phone", so a match
 *     is checked against what the field's *label* says before it is trusted.
 *     This means a pattern may be broad without being dangerous.
 */

/** @type {Array<{name: string, match: RegExp, selectors?: Record<string,string>, questions?: Record<string,string>}>} */
export const ATS_ADAPTERS = [


// ---------------------------------------------------------------------------
// Workday — by far the most valuable adapter.
//
// Rebuilt from a dump of a signed-in "My Information" step on
// workday.wd5.myworkdayjobs.com, which contradicted almost everything the
// previous version of this adapter assumed. What is actually true:
//
//   - Controls are named <group>--<field>: the id is name--legalName--firstName,
//     the name attribute is legalName--firstName, and the wrapper carries
//     formField-legalName--firstName. There is no "legalNameSection" or
//     "addressSection" anywhere, so those patterns matched nothing and this
//     adapter was inert on every field it existed for.
//   - data-automation-id is absent from the form controls themselves. The
//     meaningful names live in id, name and the wrapper — which is why the
//     collector reads ancestors, and why this adapter works at all.
//   - Labels *are* associated with `for`, contrary to what this comment used to
//     say. The sibling scan is a fallback on Workday, not the only route.
//   - Dropdowns are buttons owning a listbox, as previously assumed.
//
// The one pattern that did match was worse than the ones that did not: a plain
// "phoneNumber" hit all four controls in the phone block, and the applicant's
// number landed in the dial-code box. See the lookahead below.
//
// Everything above the work-experience group is verified. Those last patterns
// sit further into the flow than the dump covered and are still guesses,
// written to the same convention the verified fields follow.
// ---------------------------------------------------------------------------
{
  name: "Workday",
  match: /\.myworkdayjobs\.com|\.workday\.com/i,
  selectors: {
    // The trailing boundary is what keeps firstName off firstNameLocal — a
    // second set of boxes for a name written in a non-Latin script.
    "legalName[-_]+firstName\\b": "identity.firstName",
    "legalName[-_]+middleName\\b": "identity.middleName",
    "legalName[-_]+lastName\\b": "identity.lastName",
    "preferredName[-_]+firstName\\b": "identity.preferredName",
    "\\bemail\\b(?!.*confirm)": "identity.email",

    // The phone block is four controls whose ids all begin "phoneNumber--":
    // the number, the device type, the dial code and the extension. A pattern
    // of plain "phoneNumber" matches every one of them, and the number then
    // lands in whichever the sort happens to pick — on the live form, the
    // dial-code typeahead. Refusing a trailing *separator* as well as a
    // trailing letter keeps this on the field that is only ever the number,
    // which is more than `\b` can say, hence the explicit guard.
    "(?<![A-Za-z0-9])phone[-_]?number(?![A-Za-z0-9_-])": "identity.phone",
    "\\bphone[-_]?type\\b": "identity.phoneType",

    "\\baddressLine1\\b": "address.line1",
    "\\baddressLine2\\b": "address.line2",
    "\\bcity\\b": "address.city",
    "\\bpostalCode\\b": "address.postalCode",
    "\\bcountryRegion\\b": "address.stateProvince",
    // Same asymmetry as the phone number: "country" must not take
    // countryPhoneCode, under either separator convention.
    "(?<![A-Za-z0-9])country(?![A-Za-z0-9_-])": "address.country",

    "candidateIsPreviousWorker": "screening.previouslyEmployedHere",
    "source--source|howDidYouHear": "screening.howDidYouHearAboutUs",

    // --- My Experience (step 2), read off a live signed-in form.
    //
    // Keyed on the bare `name` and the wrapper, as above, because the instance
    // id carries a *random* number rather than an index:
    // `workExperience-430--jobTitle`. The previous patterns here assumed
    // `workExperience--jobTitle` and used `[-_]+`, which does not span digits,
    // so every one of them matched nothing. See
    // test/fixtures/workday-myexperience.html.
    "\\bjobTitle\\b": "work.title",
    "\\bcompanyName\\b": "work.company",
    "\\broleDescription\\b": "work.description",
    "\\bcurrentlyWorkHere\\b": "work.currentlyWorking",
    // "location" alone is too generic to let loose on every Workday step, so
    // this one is scoped to the page that owns it. Spelled out rather than
    // using \b because a boundary straight after a group close is ambiguous.
    "(?=.*applyFlowMyExpPage)(?<![A-Za-z0-9])location(?![A-Za-z0-9])": "work.location",

    "\\bschool\\b": "education.school",
    "\\bdegree\\b": "education.degree",
    "\\bfieldOfStudy\\b": "education.fieldOfStudy",

    // Refusing a trailing separator keeps this off certificationNumber, which
    // would otherwise match it too.
    "(?<![A-Za-z0-9])certification(?![A-Za-z0-9_-])": "certifications.name",
    "\\bcertificationNumber\\b": "certifications.credentialId",

    "\\bskills\\b": "skills.skills",
    "\\bwebAddress\\b": "links.website",
    "\\blinkedInAccount\\b": "links.linkedin",

    // Not mapped: the resume. The step carries two file inputs identical in
    // every attribute — both `file-upload-input-ref` inside
    // `attachments-FileUpload` / `formField-`, with no name, id or label. The
    // only thing distinguishing the Resume/CV one is the heading above it, and
    // a heading is `sectionText`, which neither selectors nor questions can
    // see. Matching `file-upload-input-ref` would be a coin toss between the
    // resume slot and some other attachment.
  },

  // A date on My Experience is three boxes — month, day, year — and the month
  // box's own id contains "endDate", so it scores 75 on the name and takes the
  // whole date: "2024-01" typed into a two-digit field. The matcher cannot
  // help here, because the name genuinely does say endDate; the control simply
  // holds one part of a value this engine produces whole. Left for the user
  // until the fill layer can address a split control.
  exclude: ["dateSection(Month|Day|Year)-input"],
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
