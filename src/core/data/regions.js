/**
 * Country and state/province lists.
 *
 * Application forms ask for country and state constantly, and they disagree
 * violently about the expected format: a `<select>` of full names, a two-letter
 * code, a three-letter code, or free text. So each entry here carries every
 * spelling we might need to recognise or emit.
 *
 * Country names are derived from `Intl.DisplayNames` rather than hard-coded.
 * That keeps ~250 country names out of the repository, and means the list stays
 * correct as the browser's CLDR data is updated instead of rotting here.
 */

/**
 * ISO 3166-1 alpha-2 codes. This is the one part that cannot be derived — the
 * platform has no API to enumerate valid regions — so it is stored compactly
 * and expanded at load.
 */
const ALPHA2 =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO " +
  "FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE " +
  "JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
  "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW " +
  "PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM " +
  "TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";

/**
 * Alpha-3 codes for the countries most likely to appear on an English-language
 * job application. Forms that want three letters are rare enough that carrying
 * all 249 mappings is not worth it; unlisted countries simply have no alpha3
 * alias and fall back to name or alpha-2 matching.
 */
const ALPHA3 = {
  US: "USA", GB: "GBR", CA: "CAN", AU: "AUS", NZ: "NZL", IE: "IRL", IN: "IND",
  DE: "DEU", FR: "FRA", ES: "ESP", IT: "ITA", NL: "NLD", BE: "BEL", CH: "CHE",
  AT: "AUT", SE: "SWE", NO: "NOR", DK: "DNK", FI: "FIN", PL: "POL", PT: "PRT",
  CZ: "CZE", RO: "ROU", GR: "GRC", HU: "HUN", JP: "JPN", CN: "CHN", KR: "KOR",
  SG: "SGP", HK: "HKG", TW: "TWN", MY: "MYS", PH: "PHL", ID: "IDN", TH: "THA",
  VN: "VNM", AE: "ARE", SA: "SAU", IL: "ISR", TR: "TUR", ZA: "ZAF", NG: "NGA",
  KE: "KEN", EG: "EGY", BR: "BRA", MX: "MEX", AR: "ARG", CL: "CHL", CO: "COL",
  PE: "PER", PK: "PAK", BD: "BGD", LK: "LKA", NP: "NPL", UA: "UKR", RU: "RUS",
};

/**
 * Extra spellings that appear on real forms but are not what CLDR returns.
 * Without these, a `<select>` offering "USA" would not be matched to a stored
 * value of "United States".
 */
const EXTRA_ALIASES = {
  US: ["United States of America", "USA", "U.S.", "U.S.A."],
  GB: ["United Kingdom of Great Britain and Northern Ireland", "UK", "Great Britain", "England"],
  KR: ["Korea, Republic of", "South Korea"],
  KP: ["Korea, Democratic People's Republic of", "North Korea"],
  TW: ["Taiwan, Province of China"],
  VN: ["Viet Nam"],
  CZ: ["Czech Republic"],
  NL: ["Holland", "The Netherlands"],
  RU: ["Russian Federation"],
  IR: ["Iran, Islamic Republic of"],
  VE: ["Venezuela, Bolivarian Republic of"],
  BO: ["Bolivia, Plurinational State of"],
  TZ: ["Tanzania, United Republic of"],
  MD: ["Moldova, Republic of"],
  MK: ["Macedonia", "North Macedonia"],
  SY: ["Syrian Arab Republic"],
  LA: ["Lao People's Democratic Republic"],
  BN: ["Brunei Darussalam"],
  CI: ["Ivory Coast"],
  CV: ["Cape Verde"],
  SZ: ["Swaziland"],
  TL: ["East Timor"],
  CD: ["Congo, Democratic Republic of the", "DR Congo"],
  AE: ["UAE"],
};

/**
 * @typedef {object} Region
 * @property {string} code   Canonical short code (ISO alpha-2 for countries).
 * @property {string} name   Display name, and the value JobFill stores.
 * @property {string[]} aliases Every other spelling a form might use.
 */

/** Build the country list once at module load. */
function buildCountries() {
  // Intl.DisplayNames is available in every Chrome that supports Manifest V3
  // and in Node 18+, so no fallback path is needed. If a code has no display
  // name the API echoes the code back, which is still a usable label.
  const display = new Intl.DisplayNames(["en"], { type: "region" });

  return ALPHA2.split(" ").map((code) => {
    const name = display.of(code) ?? code;
    // Deduped because a code can legitimately appear in both tables — "USA" is
    // both the alpha-3 code and a spelling people type by hand.
    const aliases = [...new Set([code, ALPHA3[code], ...(EXTRA_ALIASES[code] ?? [])].filter(Boolean))];
    return { code, name, aliases };
  });
}

/** @type {Region[]} Every ISO 3166-1 country, sorted by display name. */
export const COUNTRIES = buildCountries().sort((a, b) => a.name.localeCompare(b.name, "en"));

/**
 * US states, territories and DC. Kept explicit because US forms overwhelmingly
 * present a `<select>` of these and expect either the full name or the postal
 * abbreviation.
 */
export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["PR", "Puerto Rico"], ["GU", "Guam"], ["VI", "U.S. Virgin Islands"], ["AS", "American Samoa"],
].map(([code, name]) => ({ code, name, aliases: [code] }));

/** Canadian provinces and territories, same rationale as US_STATES. */
export const CA_PROVINCES = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"],
  ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"],
  ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["ON", "Ontario"],
  ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
].map(([code, name]) => ({ code, name, aliases: [code] }));

/**
 * Look a region up by any of its spellings, case- and punctuation-insensitively.
 *
 * This is what lets a stored value of "United States" match a form option
 * labelled "USA", and vice versa.
 *
 * @param {string} value  Whatever the form or the profile says.
 * @param {Region[]} list Defaults to COUNTRIES.
 * @returns {Region | undefined}
 */
export function findRegion(value, list = COUNTRIES) {
  if (!value) return undefined;
  const needle = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!needle) return undefined;

  return list.find(
    (region) =>
      region.code.toLowerCase() === needle ||
      region.name.toLowerCase().replace(/[^a-z0-9]/g, "") === needle ||
      region.aliases.some((a) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === needle)
  );
}
