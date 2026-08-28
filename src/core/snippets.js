/**
 * Ranking saved snippets against an open-ended question.
 *
 * The deliberate limit here: JobFill *suggests* a snippet, it never inserts one
 * on its own. A wrong postcode is obvious at a glance before submitting; a
 * confident, fluent answer to the wrong question is not, and it goes out under
 * the applicant's name. So this module returns candidates, and a human clicks.
 */

import { tokenize, tokenCoverage, normalizeText } from "./normalize.js";

/** Below this, a snippet is not worth offering at all. */
const MINIMUM_SCORE = 0.18;

/**
 * Rank snippets for a question.
 *
 * Scoring combines two views, because either alone misleads:
 *   - how much of the snippet's title the question contains, which catches a
 *     title written to mirror the question ("Why this company")
 *   - how much of the question the snippet's title and body cover, which
 *     catches a snippet that simply talks about the right subject
 *
 * @param {string} question   The field's label or surrounding question text.
 * @param {Array<{id: string, title: string, body: string}>} snippets
 * @param {number} [limit]
 * @returns {Array<{snippet: object, score: number}>} Best first.
 */
export function rankSnippets(question, snippets, limit = 3) {
  const questionTokens = tokenize(question);
  if (!questionTokens.length || !snippets?.length) return [];

  const ranked = [];
  for (const snippet of snippets) {
    if (!snippet?.body?.trim()) continue; // an empty snippet has nothing to offer

    const titleTokens = tokenize(snippet.title ?? "");
    const bodyTokens = tokenize(snippet.body).slice(0, 120); // long essays would swamp the overlap

    // Weighted towards the title: it is what the user wrote to describe when
    // this snippet applies, so it is the more deliberate signal.
    const titleInQuestion = tokenCoverage(titleTokens, questionTokens);
    const questionInSnippet = tokenCoverage(questionTokens, [...titleTokens, ...bodyTokens]);
    const score = titleInQuestion * 0.7 + questionInSnippet * 0.3;

    if (score >= MINIMUM_SCORE) ranked.push({ snippet, score: Number(score.toFixed(3)) });
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Whether a field looks like it wants a written answer rather than a value.
 *
 * Used to decide when to offer the snippet picker at all. A `<textarea>` is the
 * obvious case; a long question ending in a question mark is the other.
 */
export function isOpenEndedQuestion(descriptor) {
  if (descriptor?.tag === "textarea") return true;
  const label = normalizeText(descriptor?.label ?? "");
  return label.split(" ").length >= 6 && /\?\s*$/.test(descriptor?.label ?? "");
}
