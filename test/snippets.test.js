/**
 * Snippet ranking.
 *
 * The deliberate limit under test: JobFill suggests, it never inserts. A wrong
 * postcode is obvious before submitting; a fluent answer to the wrong question
 * is not, and it goes out under the applicant's name.
 */

import { describe, it, expect } from "vitest";
import { rankSnippets, isOpenEndedQuestion } from "../src/core/snippets.js";

const SNIPPETS = [
  { id: "1", title: "Why this company", body: "I have followed your work on distributed systems for years and want to build at that scale." },
  { id: "2", title: "Greatest strength", body: "Breaking ambiguous problems into pieces other people can pick up and run with." },
  { id: "3", title: "Why leaving current role", body: "I have taken my current team as far as the remit allows and want a larger surface." },
  { id: "4", title: "Empty one", body: "" },
];

describe("rankSnippets", () => {
  it("puts the snippet written for the question first", () => {
    const [best] = rankSnippets("Why do you want to work at this company?", SNIPPETS);
    expect(best.snippet.id).toBe("1");
  });

  it("matches a strengths question to the strengths snippet", () => {
    const [best] = rankSnippets("What would you say is your greatest strength?", SNIPPETS);
    expect(best.snippet.id).toBe("2");
  });

  it("matches a question about leaving", () => {
    const [best] = rankSnippets("Why are you leaving your current role?", SNIPPETS);
    expect(best.snippet.id).toBe("3");
  });

  it("never offers a snippet with an empty body", () => {
    // It would insert nothing, which reads as a bug rather than a choice.
    const ranked = rankSnippets("Empty one", SNIPPETS);
    expect(ranked.every((r) => r.snippet.id !== "4")).toBe(true);
  });

  it("returns nothing for a question unrelated to any snippet", () => {
    expect(rankSnippets("What is your postcode?", SNIPPETS)).toEqual([]);
  });

  it("returns nothing when there are no snippets", () => {
    expect(rankSnippets("Why this company?", [])).toEqual([]);
    expect(rankSnippets("Why this company?", null)).toEqual([]);
  });

  it("returns nothing for an empty question", () => {
    expect(rankSnippets("", SNIPPETS)).toEqual([]);
  });

  it("orders by score, best first", () => {
    const ranked = rankSnippets("Why do you want to work at this company?", SNIPPETS);
    const scores = ranked.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("caps how many it offers", () => {
    expect(rankSnippets("Why this company strength leaving role", SNIPPETS, 2).length).toBeLessThanOrEqual(2);
  });
});

describe("isOpenEndedQuestion", () => {
  it("treats any textarea as open-ended", () => {
    expect(isOpenEndedQuestion({ tag: "textarea", label: "Anything else?" })).toBe(true);
  });

  it("treats a long question ending in a question mark as open-ended", () => {
    expect(isOpenEndedQuestion({
      tag: "input", label: "Why do you want to work at this company in particular?",
    })).toBe(true);
  });

  it("does not treat an ordinary short field as open-ended", () => {
    expect(isOpenEndedQuestion({ tag: "input", label: "First name" })).toBe(false);
    expect(isOpenEndedQuestion({ tag: "input", label: "Email?" })).toBe(false);
  });

  it("copes with a field that has no label", () => {
    expect(isOpenEndedQuestion({ tag: "input" })).toBe(false);
    expect(isOpenEndedQuestion(null)).toBe(false);
  });
});
