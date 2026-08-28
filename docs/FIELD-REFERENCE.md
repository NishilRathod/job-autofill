# Field reference

Everything JobFill can store and fill. **This file is generated** from
[`src/core/schema.js`](../src/core/schema.js) by `npm run docs` — edit the schema, not this file.

There are **105 fields** across **15 sections**. You do not need to fill them all in; JobFill skips anything you leave blank.

Each field has a canonical path like `identity.firstName`. Sections marked
**repeating** store a list, and their paths carry an index: `work.0.company`.

## Sections

- [Identity](#identity) · `identity` · 10 fields
- [Address](#address) · `address` · 7 fields
- [Links](#links) · `links` · 10 fields
- [Work eligibility](#eligibility) · `eligibility` · 7 fields
- [Availability & preferences](#preferences) · `preferences` · 8 fields
- [Employment history](#work) · `work` · 13 fields — repeating
- [Education](#education) · `education` · 11 fields — repeating
- [Skills & credentials](#skills) · `skills` · 2 fields
- [Languages](#languages) · `languages` · 2 fields — repeating
- [Certifications](#certifications) · `certifications` · 5 fields — repeating
- [References](#references) · `references` · 6 fields — repeating
- [Screening questions](#screening) · `screening` · 8 fields
- [Signature & certification](#signature) · `signature` · 3 fields
- [Voluntary self-identification](#demographics) · `demographics` · 7 fields — **opt-in**
- [Documents](#documents) · `documents` · 6 fields

---

## Identity

<a id="identity"></a>

The name and contact details every application asks for first.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| First name | `identity.firstName` | free text | Maps to the HTML `given-name` autocomplete token. |
| Middle name | `identity.middleName` | free text | Maps to the HTML `additional-name` autocomplete token. |
| Last name | `identity.lastName` | free text | Maps to the HTML `family-name` autocomplete token. |
| Preferred name | `identity.preferredName` | free text | What you go by, if it differs from your legal first name. Maps to the HTML `nickname` autocomplete token. |
| Full name | `identity.fullName` | free text | Filled automatically from your first and last name unless you override it. Filled automatically from other fields unless you override it. Maps to the HTML `name` autocomplete token. |
| Pronouns | `identity.pronouns` | `He/Him`, `She/Her`, `They/Them`, `He/They`, `She/They`, `Prefer not to say` |  |
| Email | `identity.email` | free text | Maps to the HTML `email` autocomplete token. |
| Phone | `identity.phone` | free text | Store it with a country code. JobFill reformats it to match what each form expects. Maps to the HTML `tel` autocomplete token. |
| Phone type | `identity.phoneType` | `Mobile`, `Home`, `Work` |  |
| Date of birth | `identity.dateOfBirth` | `YYYY-MM-DD` | Rarely asked outside of some non-US and government applications. Leave blank if you prefer. Maps to the HTML `bday` autocomplete token. |

---

## Address

<a id="address"></a>

Your current mailing address, and how you describe where you live.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Street address | `address.line1` | free text | Maps to the HTML `address-line1` autocomplete token. |
| Apartment, suite, etc. | `address.line2` | free text | Maps to the HTML `address-line2` autocomplete token. |
| City | `address.city` | free text | Maps to the HTML `address-level2` autocomplete token. |
| State / Province | `address.stateProvince` | one of 55 options (Alabama, Alaska, Arizona, …) | Full name or abbreviation — JobFill converts between them as each form requires. Maps to the HTML `address-level1` autocomplete token. |
| ZIP / Postal code | `address.postalCode` | free text | Maps to the HTML `postal-code` autocomplete token. |
| Country | `address.country` | one of 249 options (Afghanistan, Åland Islands, Albania, …) | Maps to the HTML `country-name` autocomplete token. |
| Location, as one line | `address.currentLocationText` | free text | For forms with a single "Location" box. Built from your city, state and country unless you override it. Filled automatically from other fields unless you override it. |

---

## Links

<a id="links"></a>

Profiles and portfolios. Include the full https:// URL.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| LinkedIn | `links.linkedin` | free text |  |
| GitHub | `links.github` | free text |  |
| Portfolio | `links.portfolio` | free text |  |
| Personal website | `links.website` | free text | Maps to the HTML `url` autocomplete token. |
| X / Twitter | `links.twitter` | free text |  |
| Stack Overflow | `links.stackoverflow` | free text |  |
| Behance | `links.behance` | free text |  |
| Dribbble | `links.dribbble` | free text |  |
| Google Scholar | `links.googleScholar` | free text |  |
| Other link | `links.otherLink` | free text |  |

---

## Work eligibility

<a id="eligibility"></a>

Standard screening questions. These are filled by default — they are not protected-class data.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Authorised to work in the country of the role | `eligibility.authorizedToWork` | `Yes`, `No` |  |
| Now or in future requires visa sponsorship | `eligibility.requiresSponsorship` | `Yes`, `No` | Read these carefully on real forms — many phrase it as "will you require sponsorship", which inverts the answer. |
| Work authorisation type | `eligibility.workAuthType` | one of 18 options (Citizen, Permanent Resident, Green Card, …) |  |
| Visa status, in your own words | `eligibility.visaStatus` | free text |  |
| Security clearance | `eligibility.securityClearance` | free text | Write "None" rather than leaving blank, so the field is not skipped. |
| Holds a driving licence | `eligibility.hasDriversLicense` | `Yes`, `No` |  |
| Aged 18 or over | `eligibility.over18` | `Yes`, `No` |  |

---

## Availability & preferences

<a id="preferences"></a>

Start date, location flexibility, and compensation expectations.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Notice period | `preferences.noticePeriod` | `Immediately`, `1 week`, `2 weeks`, `1 month`, `2 months`, `3 months` |  |
| Earliest start date | `preferences.earliestStartDate` | `YYYY-MM-DD` |  |
| Willing to relocate | `preferences.willingToRelocate` | `Yes`, `No` |  |
| Work arrangement preference | `preferences.remotePreference` | `Remote`, `Hybrid`, `On-site`, `No preference` |  |
| Willing to travel | `preferences.willingToTravel` | free text |  |
| Desired salary | `preferences.desiredSalary` | free text | Store just the number. Some forms reject currency symbols and commas. |
| Current salary | `preferences.currentSalary` | free text |  |
| Currency | `preferences.salaryCurrency` | `USD`, `CAD`, `GBP`, `EUR`, `INR`, `AUD`, `NZD`, `SGD`, `CHF`, `JPY`, `AED` |  |

---

## Employment history

<a id="work"></a>

Most recent first. Many forms only ask for the latest one or two.

> **Repeating section.** Holds up to 12 entries, each one a "Position". Paths include the entry index, e.g. `work.0.company`.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Company | `work.company` | free text | Maps to the HTML `organization` autocomplete token. |
| Job title | `work.title` | free text | Maps to the HTML `organization-title` autocomplete token. |
| Employment type | `work.employmentType` | `Full-time`, `Part-time`, `Contract`, `Internship`, `Freelance`, `Temporary` |  |
| Location | `work.location` | free text |  |
| Start date | `work.startDate` | `YYYY-MM` |  |
| End date | `work.endDate` | `YYYY-MM` | Leave blank if this is your current role. |
| This is my current role | `work.currentlyWorking` | yes / no |  |
| What you did | `work.description` | free text |  |
| Reason for leaving | `work.reasonForLeaving` | free text |  |
| Manager's name | `work.supervisorName` | free text | Asked by background-check style applications, mostly in the US. |
| Manager's title | `work.supervisorTitle` | free text |  |
| Manager's phone or email | `work.supervisorContact` | free text |  |
| May we contact this employer | `work.mayWeContact` | `Yes`, `No` |  |

---

## Education

<a id="education"></a>

Most recent first.

> **Repeating section.** Holds up to 8 entries, each one a "Qualification". Paths include the entry index, e.g. `education.0.school`.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| School or university | `education.school` | free text |  |
| Degree | `education.degree` | `High School Diploma`, `Associate's Degree`, `Bachelor's Degree`, `Master's Degree`, `MBA`, `Doctorate (PhD)`, `Professional Degree (JD, MD)`, `Certificate`, `Bootcamp`, `Other` |  |
| Field of study | `education.fieldOfStudy` | free text |  |
| Minor | `education.minor` | free text |  |
| Location | `education.location` | free text |  |
| Start date | `education.startDate` | `YYYY-MM` |  |
| End date or expected graduation | `education.endDate` | `YYYY-MM` |  |
| Currently attending | `education.currentlyAttending` | yes / no |  |
| GPA or grade | `education.gpa` | free text |  |
| Out of | `education.gpaScale` | free text |  |
| Honours or awards | `education.honors` | free text |  |

---

## Skills & credentials

<a id="skills"></a>

Used for skills boxes, language questions, and certification lists.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Skills | `skills.skills` | comma-separated list | Comma-separated. Filled into skills boxes and used to match skill checkboxes. |
| Professional summary | `skills.summary` | free text | For "tell us about yourself" boxes. Longer answers belong in Snippets. |

---

## Languages

<a id="languages"></a>

> **Repeating section.** Holds up to 10 entries, each one a "Language". Paths include the entry index, e.g. `languages.0.name`.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Language | `languages.name` | free text |  |
| Proficiency | `languages.proficiency` | `Native or bilingual`, `Fluent`, `Professional working`, `Limited working`, `Elementary` |  |

---

## Certifications

<a id="certifications"></a>

> **Repeating section.** Holds up to 12 entries, each one a "Certification". Paths include the entry index, e.g. `certifications.0.name`.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Certification | `certifications.name` | free text |  |
| Issuing organisation | `certifications.issuer` | free text |  |
| Issued | `certifications.issueDate` | `YYYY-MM` |  |
| Expires | `certifications.expiryDate` | `YYYY-MM` |  |
| Credential ID | `certifications.credentialId` | free text |  |

---

## References

<a id="references"></a>

Some applications ask for these up front rather than after an offer.

> **Repeating section.** Holds up to 6 entries, each one a "Reference". Paths include the entry index, e.g. `references.0.name`.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Name | `references.name` | free text |  |
| Relationship | `references.relationship` | free text |  |
| Company | `references.company` | free text |  |
| Job title | `references.title` | free text |  |
| Email | `references.email` | free text |  |
| Phone | `references.phone` | free text |  |

---

## Screening questions

<a id="screening"></a>

The miscellaneous questions that appear near the end of most applications.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| How did you hear about us | `screening.howDidYouHearAboutUs` | `Company website`, `LinkedIn`, `Indeed`, `Glassdoor`, `Job board`, `Employee referral`, `Recruiter`, `University or career fair`, `Social media`, `Friend or colleague`, `Other` |  |
| Referred by | `screening.referredByName` | free text | The employee who referred you, if any. |
| Previously employed by this company | `screening.previouslyEmployedHere` | `Yes`, `No` |  |
| Related to a current employee | `screening.relatedToEmployee` | `Yes`, `No` |  |
| Applied to this company before | `screening.appliedBefore` | `Yes`, `No` |  |
| Consents to a background check | `screening.backgroundCheckConsent` | `Yes`, `No` |  |
| Consents to a drug test | `screening.drugTestConsent` | `Yes`, `No` |  |
| Bound by a non-compete | `screening.nonCompete` | `Yes`, `No` |  |

---

## Signature & certification

<a id="signature"></a>

The attestation at the bottom of an application form.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Typed signature | `signature.signatureFullName` | free text | Defaults to your full name. Forms ask you to type it to certify the application. Filled automatically from other fields unless you override it. |
| Initials | `signature.signatureInitials` | free text |  |
| Signature date | `signature.signatureDate` | `Today's date`, `Leave blank` | With "Today's date", JobFill fills the current date at the moment you fill the form. |

---

## Voluntary self-identification

<a id="demographics"></a>

Protected-class information collected for equal-opportunity reporting. JobFill will not fill any of it unless you explicitly turn on the demographics setting, and every answer defaults to "Prefer not to say". Answering is voluntary on every form that asks.

> **Opt-in.** JobFill never fills these unless you turn on the demographics
> setting. Every answer defaults to declining to answer.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Gender | `demographics.gender` | `Male`, `Female`, `Non-binary`, `Prefer not to say` |  |
| Hispanic or Latino | `demographics.hispanicOrLatino` | `Yes`, `No`, `Prefer not to say` |  |
| Race / ethnicity | `demographics.raceEthnicity` | `American Indian or Alaska Native`, `Asian`, `Black or African American`, `Hispanic or Latino`, `Native Hawaiian or Other Pacific Islander`, `White`, `Two or More Races`, `Prefer not to say` |  |
| Veteran status | `demographics.veteranStatus` | `I am not a protected veteran`, `I identify as one or more of the classifications of a protected veteran`, `I do not wish to answer` |  |
| Disability status | `demographics.disabilityStatus` | `Yes, I have a disability, or have had one in the past`, `No, I do not have a disability and have not had one in the past`, `I do not want to answer` |  |
| Sexual orientation | `demographics.sexualOrientation` | `Heterosexual`, `Gay or lesbian`, `Bisexual`, `Other`, `Prefer not to say` |  |
| Transgender identity | `demographics.transgenderIdentity` | `Yes`, `No`, `Prefer not to say` |  |

---

## Documents

<a id="documents"></a>

Stored in this extension's local database and attached to file uploads. They are read only to attach to a page you opened, and never leave your computer.

| Field | Path | Accepts | Notes |
| --- | --- | --- | --- |
| Resume / CV | `documents.resume` | an uploaded file |  |
| Cover letter | `documents.coverLetterFile` | an uploaded file |  |
| Transcript | `documents.transcript` | an uploaded file |  |
| Portfolio | `documents.portfolioFile` | an uploaded file |  |
| Writing sample | `documents.writingSample` | an uploaded file |  |
| Cover letter, as text | `documents.coverLetterText` | free text | For forms with a cover letter textarea instead of a file upload. |

---

## Questions JobFill will not answer

Criminal-history questions are deliberately left blank. Their wording varies by
jurisdiction in ways that change the correct answer — *convicted* versus *arrested*,
spent convictions, sealed records, ban-the-box rules — and a confidently wrong
auto-answer on a submitted application is far worse than an empty box. JobFill
reports these as skipped so you answer them yourself.

Detected by these phrases:

`criminal record` · `criminal history` · `convicted` · `conviction` · `felony` · `misdemeanor` · `arrested` · `pleaded guilty` · `plead guilty` · `background check history`
