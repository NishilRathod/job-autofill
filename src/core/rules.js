/**
 * Matching rules: how each canonical field is recognised on a page.
 *
 * Most rules are derived from the schema rather than written out. A field
 * labelled "First name" with key `firstName` already tells us the phrase and
 * the tokens to look for, and duplicating that here would guarantee the two
 * drift apart. This file therefore holds only what the schema cannot express:
 *
 *   - `aliases`  — wordings a form uses that the label does not cover
 *   - `veto`     — phrases that must rule a field OUT, however well it scores
 *   - `context`  — section headings that make this field more likely
 *
 * Vetoes carry the most weight of anything in this file. An application form is
 * full of near-misses: "Emergency contact first name" is not your first name,
 * "Confirm email" is not your email, and a manager's phone number is not yours.
 * Without vetoes a token matcher gets all three wrong, and gets them wrong
 * confidently.
 */

import { ALL_FIELDS } from "./schema.js";
import { tokenize } from "./normalize.js";

/**
 * Phrases that mean a field belongs to somebody else, not the applicant.
 *
 * Applied to every identity, address and contact field, because each of them
 * has a "someone else's" twin somewhere on a long application form.
 */
const SOMEONE_ELSE = [
  "emergency", "next of kin", "kin", "spouse", "partner", "parent", "guardian",
  "reference", "referee", "referral contact", "supervisor", "manager name",
  "employer contact", "recruiter", "witness", "beneficiary", "dependent",
];

/** Phrases meaning "type it again", which must never receive the real value. */
const CONFIRMATION = ["confirm", "re enter", "reenter", "verify", "repeat", "again"];

/**
 * Per-path overrides. Every key is a canonical path from schema.js.
 * @type {Record<string, {aliases?: string[], veto?: string[], context?: string[], priority?: number}>}
 */
export const RULE_OVERRIDES = {
  // --- Identity ------------------------------------------------------------
  "identity.firstName": {
    aliases: ["given name", "forename", "legal first name", "first"],
    veto: [...SOMEONE_ELSE, "last name", "middle name", "maiden", "preferred", "full name", "user name", "username"],
  },
  "identity.lastName": {
    aliases: ["family name", "surname", "legal last name", "last"],
    veto: [...SOMEONE_ELSE, "first name", "middle name", "maiden", "full name", "user name", "username"],
  },
  "identity.middleName": {
    aliases: ["middle initial", "middle names"],
    veto: [...SOMEONE_ELSE, "first name", "last name"],
  },
  "identity.preferredName": {
    aliases: ["nickname", "known as", "goes by", "preferred first name", "display name"],
    veto: [...SOMEONE_ELSE, "legal", "user name", "username"],
  },
  "identity.fullName": {
    aliases: ["name", "your name", "applicant name", "candidate name", "legal name"],
    // "name" alone is the single most over-matched token on a form, so full
    // name has to reject every compound that means something more specific.
    veto: [
      ...SOMEONE_ELSE, "first", "last", "middle", "maiden", "user name", "username",
      "company", "employer", "school", "university", "file", "job", "position",
      "title", "product", "team", "preferred",
    ],
  },
  "identity.email": {
    aliases: ["email address", "e mail", "contact email"],
    veto: [...SOMEONE_ELSE, ...CONFIRMATION],
  },
  "identity.confirmEmail": { aliases: ["confirm email", "re enter email", "verify email"] },
  "identity.phone": {
    aliases: ["phone number", "mobile number", "contact number", "telephone", "primary phone"],
    veto: [...SOMEONE_ELSE, ...CONFIRMATION, "fax", "extension", "country code"],
  },
  "identity.dateOfBirth": { aliases: ["date of birth", "birth date", "born"] },
  "identity.pronouns": { aliases: ["preferred pronouns", "pronoun"] },

  // --- Address -------------------------------------------------------------
  "address.line1": {
    aliases: ["street address", "address line 1", "address", "street", "house number and street"],
    veto: [...SOMEONE_ELSE, "email", "website", "url", "line 2", "apartment", "ip"],
  },
  "address.line2": { aliases: ["address line 2", "apartment", "apt", "suite", "unit", "floor"] },
  "address.city": { aliases: ["town", "city or town", "locality"], veto: [...SOMEONE_ELSE] },
  "address.stateProvince": {
    aliases: ["state", "province", "state or province", "region", "county"],
    veto: [...SOMEONE_ELSE, "country", "united states", "citizenship"],
  },
  "address.postalCode": { aliases: ["zip", "zip code", "postcode", "postal"] },
  "address.country": { aliases: ["country", "country of residence"], veto: ["citizenship", "code", "phone"] },
  "address.currentLocationText": {
    aliases: ["location", "current location", "where are you based", "where do you live"],
    veto: ["job location", "office location", "preferred location", "work location", "relocate"],
  },

  // --- Links ---------------------------------------------------------------
  "links.linkedin": { aliases: ["linkedin", "linked in", "linkedin profile", "linkedin url"] },
  "links.github": { aliases: ["github", "git hub", "github profile", "github url"] },
  "links.portfolio": { aliases: ["portfolio", "portfolio url", "work samples"] },
  "links.website": {
    aliases: ["website", "personal website", "personal site", "blog", "homepage", "other url"],
    veto: ["company website", "linkedin", "github", "portfolio"],
  },
  "links.twitter": { aliases: ["twitter", "twitter handle", "x com profile"] },
  "links.stackoverflow": { aliases: ["stack overflow", "stackoverflow"] },
  "links.behance": { aliases: ["behance"] },
  "links.dribbble": { aliases: ["dribbble"] },
  "links.googleScholar": { aliases: ["google scholar", "scholar"] },
  "links.otherLink": { aliases: ["other website", "additional link", "other link"] },

  // --- Work eligibility ----------------------------------------------------
  "eligibility.authorizedToWork": {
    aliases: [
      "legally authorized to work", "authorized to work", "eligible to work",
      "right to work", "legally entitled to work", "work authorization",
      "are you authorized", "legally permitted to work",
    ],
    // Sponsorship is the mirror-image question and is answered separately.
    // Conflating them produces exactly the wrong answer.
    veto: ["sponsorship", "sponsor", "visa status", "require support"],
  },
  "eligibility.requiresSponsorship": {
    aliases: [
      "require sponsorship", "need sponsorship", "visa sponsorship",
      "will you now or in the future require sponsorship", "require immigration sponsorship",
      "sponsorship to work", "require a visa",
    ],
    veto: ["authorized to work", "eligible to work", "right to work"],
  },
  "eligibility.workAuthType": {
    aliases: ["work authorization status", "immigration status", "visa type", "employment authorization"],
  },
  "eligibility.visaStatus": { aliases: ["visa status", "current visa"] },
  "eligibility.securityClearance": { aliases: ["security clearance", "clearance level", "clearance"] },
  "eligibility.hasDriversLicense": { aliases: ["driver s license", "drivers licence", "driving licence", "valid license"] },
  "eligibility.over18": { aliases: ["18 years", "over 18", "at least 18", "age of 18", "legal working age"] },

  // --- Availability & preferences -----------------------------------------
  "preferences.noticePeriod": { aliases: ["notice period", "notice", "how much notice"] },
  "preferences.earliestStartDate": {
    aliases: ["start date", "available start", "earliest start", "when can you start", "availability date"],
    veto: ["employment", "education", "previous", "current role"],
  },
  "preferences.willingToRelocate": { aliases: ["willing to relocate", "open to relocation", "relocate"] },
  "preferences.remotePreference": { aliases: ["work arrangement", "remote", "hybrid", "on site preference", "work preference"] },
  "preferences.willingToTravel": { aliases: ["willing to travel", "travel requirement", "able to travel"] },
  "preferences.desiredSalary": {
    aliases: [
      "desired salary", "expected salary", "salary expectation", "compensation expectation",
      "expected compensation", "desired compensation", "salary requirement", "expected ctc",
    ],
    veto: ["current salary", "current compensation", "current ctc"],
  },
  "preferences.currentSalary": {
    aliases: ["current salary", "current compensation", "present salary", "current ctc"],
    veto: ["expected", "desired", "requirement"],
  },
  "preferences.salaryCurrency": { aliases: ["currency"] },

  // --- Employment history --------------------------------------------------
  "work.company": {
    aliases: ["employer", "company name", "organisation", "current employer", "most recent employer"],
    context: ["employment", "work experience", "experience", "work history", "previous employment"],
    veto: ["school", "university", "reference", "why", "how did you hear"],
  },
  "work.title": {
    aliases: ["job title", "position", "role", "your title", "most recent title"],
    context: ["employment", "work experience", "experience", "work history"],
    veto: ["degree", "school", "reference", "position applied", "position you are applying"],
  },
  "work.location": { context: ["employment", "work experience", "work history"], veto: ["your location", "current location"] },
  "work.startDate": { aliases: ["from", "start"], context: ["employment", "work experience", "work history"] },
  "work.endDate": { aliases: ["to", "end", "until"], context: ["employment", "work experience", "work history"] },
  "work.currentlyWorking": { aliases: ["currently work here", "i currently work here", "present", "current role"] },
  "work.description": {
    aliases: ["responsibilities", "duties", "what you did", "job description", "achievements"],
    context: ["employment", "work experience", "work history"],
  },
  "work.reasonForLeaving": { aliases: ["reason for leaving", "why did you leave"] },
  "work.supervisorName": { aliases: ["supervisor", "supervisor name", "manager name", "reporting manager"] },
  "work.supervisorTitle": { aliases: ["supervisor title", "manager title"] },
  "work.supervisorContact": { aliases: ["supervisor phone", "supervisor email", "manager contact"] },
  "work.mayWeContact": { aliases: ["may we contact", "contact this employer", "ok to contact"] },
  "work.employmentType": { aliases: ["employment type", "job type"] },

  // --- Education -----------------------------------------------------------
  "education.school": {
    aliases: ["university", "college", "institution", "school name", "educational institution"],
    context: ["education", "academic", "qualification"],
    veto: ["high school only", "company", "employer"],
  },
  "education.degree": {
    aliases: ["degree", "qualification", "degree level", "education level", "highest degree"],
    context: ["education", "academic"],
  },
  "education.fieldOfStudy": {
    aliases: ["field of study", "major", "discipline", "subject", "course", "concentration"],
    context: ["education", "academic"],
  },
  "education.minor": { aliases: ["minor"], context: ["education"] },
  "education.gpa": { aliases: ["gpa", "grade point average", "grade", "marks", "percentage"], context: ["education"] },
  "education.gpaScale": { aliases: ["gpa scale", "out of", "maximum gpa"], context: ["education"] },
  "education.startDate": { aliases: ["from", "start"], context: ["education", "academic"] },
  "education.endDate": {
    aliases: ["graduation date", "graduated", "expected graduation", "completion date", "to", "end"],
    context: ["education", "academic"],
  },
  "education.currentlyAttending": { aliases: ["currently attending", "currently enrolled", "still studying"] },
  "education.honors": { aliases: ["honors", "honours", "awards", "distinctions"], context: ["education"] },
  "education.location": { context: ["education", "academic"], veto: ["your location", "current location"] },

  // --- Skills --------------------------------------------------------------
  "skills.skills": { aliases: ["skills", "key skills", "technical skills", "competencies"] },
  "skills.summary": {
    aliases: ["summary", "professional summary", "about you", "tell us about yourself", "bio"],
  },

  // --- Languages, certifications, references -------------------------------
  "languages.name": { aliases: ["language"], context: ["language"] },
  "languages.proficiency": { aliases: ["proficiency", "fluency", "level"], context: ["language"] },
  "certifications.name": { aliases: ["certification", "certificate", "license name"], context: ["certification", "licence", "license"] },
  "certifications.issuer": { aliases: ["issuing organization", "issued by", "awarding body"], context: ["certification"] },
  "certifications.credentialId": { aliases: ["credential id", "license number", "certificate number"], context: ["certification"] },
  "references.name": { aliases: ["reference name", "referee name"], context: ["reference", "referee"] },
  "references.relationship": { aliases: ["relationship", "how do you know"], context: ["reference", "referee"] },
  "references.company": { aliases: ["reference company", "referee company"], context: ["reference", "referee"] },
  "references.title": { aliases: ["reference title", "referee title"], context: ["reference", "referee"] },
  "references.email": { aliases: ["reference email", "referee email"], context: ["reference", "referee"] },
  "references.phone": { aliases: ["reference phone", "referee phone"], context: ["reference", "referee"] },

  // --- Screening -----------------------------------------------------------
  "screening.howDidYouHearAboutUs": {
    // "how did you hear" without a trailing "us": forms ask it as "…about this
    // job", "…about this role", "…about this opening", and requiring the literal
    // word "us" makes every one of those miss.
    aliases: [
      "how did you hear", "how did you hear about us", "how did you find",
      "source", "referral source", "how did you learn about",
    ],
  },
  "screening.referredByName": { aliases: ["referred by", "referrer", "employee referral", "who referred you"] },
  "screening.previouslyEmployedHere": {
    // "…worked for this company before?" otherwise goes to work.company, which
    // matches on the bare word "company" and would write an employer name into
    // a yes/no question. The longer phrasings win on specificity.
    aliases: [
      "previously employed", "worked here before", "former employee",
      "ever been employed by", "worked for this company before",
      "worked for us before", "employed by this company",
    ],
  },
  "screening.relatedToEmployee": { aliases: ["related to", "relative", "family member employed", "know anyone who works"] },
  "screening.appliedBefore": { aliases: ["applied before", "previously applied", "prior application"] },
  "screening.backgroundCheckConsent": { aliases: ["background check", "consent to a background"] },
  "screening.drugTestConsent": { aliases: ["drug test", "drug screening"] },
  "screening.nonCompete": { aliases: ["non compete", "noncompete", "restrictive covenant"] },

  // --- Signature -----------------------------------------------------------
  "signature.signatureFullName": {
    aliases: ["signature", "electronic signature", "e signature", "type your name", "sign here", "digital signature"],
  },
  "signature.signatureInitials": { aliases: ["initials"] },
  "signature.signatureDate": { aliases: ["date signed", "signature date", "today s date"] },

  // --- Demographics --------------------------------------------------------
  "demographics.gender": { aliases: ["gender", "sex", "gender identity"], veto: ["pronoun"] },
  "demographics.hispanicOrLatino": { aliases: ["hispanic", "latino", "hispanic or latino"] },
  "demographics.raceEthnicity": { aliases: ["race", "ethnicity", "race ethnicity", "ethnic origin", "racial"] },
  "demographics.veteranStatus": { aliases: ["veteran", "veteran status", "protected veteran", "military service"] },
  "demographics.disabilityStatus": { aliases: ["disability", "disability status", "disabled"] },
  "demographics.sexualOrientation": { aliases: ["sexual orientation"] },
  "demographics.transgenderIdentity": { aliases: ["transgender"] },

  // --- Documents -----------------------------------------------------------
  "documents.resume": {
    aliases: ["resume", "cv", "curriculum vitae", "upload resume", "attach resume"],
    veto: ["cover letter", "transcript", "portfolio", "writing sample", "photo"],
    // Ranked above other documents: when a form has one unlabelled file input,
    // it wants a resume far more often than anything else.
    priority: 2,
  },
  "documents.coverLetterFile": {
    aliases: ["cover letter", "covering letter", "motivation letter"],
    veto: ["resume", "cv"],
  },
  "documents.coverLetterText": { aliases: ["cover letter", "covering letter", "why do you want", "motivation"] },
  "documents.transcript": { aliases: ["transcript", "academic transcript", "grades document"] },
  "documents.portfolioFile": { aliases: ["portfolio file", "portfolio upload", "work samples"] },
  "documents.writingSample": { aliases: ["writing sample"] },
};

/**
 * Build the complete rule set: schema-derived defaults, plus overrides.
 *
 * @returns {Array<{
 *   path: string, sensitive: boolean, autocomplete?: string, priority: number,
 *   phrases: string[], phraseTokens: string[][], veto: string[][], context: string[][]
 * }>}
 */
function buildRules() {
  return ALL_FIELDS.map((field) => {
    const override = RULE_OVERRIDES[field.path] ?? {};

    // The label is always a phrase worth matching; aliases add the wordings a
    // form uses that the label does not.
    const phrases = [field.label, ...(override.aliases ?? [])];

    return {
      path: field.path,
      sectionId: field.sectionId,
      sensitive: field.sensitive,
      autocomplete: field.autocomplete,
      type: field.type,
      priority: override.priority ?? 1,
      phrases,
      // Pre-tokenised so the matcher does no string work per field per scan.
      phraseTokens: phrases.map(tokenize).filter((t) => t.length),
      veto: (override.veto ?? []).map(tokenize).filter((t) => t.length),
      context: (override.context ?? []).map(tokenize).filter((t) => t.length),
    };
  });
}

/** @type {ReturnType<typeof buildRules>} Built once; the schema never changes. */
export const RULES = buildRules();

/** @type {Map<string, typeof RULES[number]>} */
export const RULE_BY_PATH = new Map(RULES.map((rule) => [rule.path, rule]));
