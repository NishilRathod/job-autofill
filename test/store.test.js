/**
 * Tests for the persistence layer.
 *
 * The behaviour worth protecting here is resilience: a profile written by an
 * older version of the extension must still load, and a malformed import must
 * not destroy a real profile.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createStore, withDefaults, migrate, domainKeyFor } from "../src/storage/store.js";
import { SCHEMA_VERSION } from "../src/core/defaults.js";
import { createFakeStorageArea } from "./helpers/fake-storage.js";

/** A store backed by fresh in-memory storage. */
function freshStore(initial = {}) {
  const area = createFakeStorageArea(initial);
  return { store: createStore(area), area };
}

describe("createStore", () => {
  it("refuses to construct without a storage area", () => {
    // Failing loudly beats silently no-op'ing every save.
    expect(() => createStore(undefined)).toThrow(/storage area/i);
  });

  it("returns a complete default profile on a fresh install", async () => {
    const { store } = freshStore();
    const profile = await store.getProfile();
    expect(profile.identity.firstName).toBe("");
    expect(profile.work).toHaveLength(1);
  });

  it("round-trips a saved profile", async () => {
    const { store } = freshStore();
    const profile = await store.getProfile();
    profile.identity.firstName = "Ada";
    await store.saveProfile(profile);
    expect((await store.getProfile()).identity.firstName).toBe("Ada");
  });
});

describe("setValue", () => {
  let store;
  beforeEach(() => ({ store } = freshStore()));

  it("writes a simple path", async () => {
    await store.setValue("identity.email", "ada@example.com");
    expect((await store.getProfile()).identity.email).toBe("ada@example.com");
  });

  it("writes into a repeating section by index", async () => {
    await store.setValue("work.0.company", "Analytical Engines Ltd");
    expect((await store.getProfile()).work[0].company).toBe("Analytical Engines Ltd");
  });

  it("grows a repeating section when the editor adds a row", async () => {
    // The editor can render a third entry before anything has been stored for
    // it, so writing to an index past the end must not throw.
    await store.setValue("work.2.company", "Third Job");
    const work = (await store.getProfile()).work;
    expect(work).toHaveLength(3);
    expect(work[2].company).toBe("Third Job");
    expect(work[1].company).toBe(""); // the gap is filled with a blank entry
  });

  it("leaves sibling fields untouched", async () => {
    await store.setValue("identity.firstName", "Ada");
    await store.setValue("identity.lastName", "Lovelace");
    const identity = (await store.getProfile()).identity;
    expect(identity.firstName).toBe("Ada");
    expect(identity.lastName).toBe("Lovelace");
  });
});

describe("withDefaults", () => {
  it("adds fields introduced after a profile was saved", async () => {
    // Simulates upgrading the extension: stored data predates a schema change.
    const stale = { profile: { identity: { firstName: "Ada" } } };
    const result = withDefaults(stale);
    expect(result.profile.identity.firstName).toBe("Ada");
    expect(result.profile.identity.email).toBe("");
    expect(result.profile.education).toHaveLength(1);
  });

  it("keeps every stored entry in a repeating section", () => {
    const stored = { profile: { work: [{ company: "A" }, { company: "B" }, { company: "C" }] } };
    const result = withDefaults(stored);
    expect(result.profile.work.map((w) => w.company)).toEqual(["A", "B", "C"]);
    // ...and backfills the fields those entries never had.
    expect(result.profile.work[0].title).toBe("");
  });

  it("repairs a repeating section stored as the wrong type", () => {
    const result = withDefaults({ profile: { work: "corrupted" } });
    expect(Array.isArray(result.profile.work)).toBe(true);
    expect(result.profile.work).toHaveLength(1);
  });

  it("restores missing settings without discarding the user's choices", () => {
    const result = withDefaults({ settings: { fillDemographics: true } });
    expect(result.settings.fillDemographics).toBe(true); // kept
    expect(result.settings.overwriteExisting).toBe(false); // restored
  });
});

describe("migrate", () => {
  it("stamps the current version onto unversioned state", () => {
    expect(withDefaults(migrate({})).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("leaves state from a newer version alone", () => {
    // This happens when a user downgrades. Mangling their profile to fit an
    // older schema would be far worse than a few fields not filling.
    const future = { schemaVersion: SCHEMA_VERSION + 5, profile: { identity: { firstName: "Ada" } } };
    const result = migrate(future);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION + 5);
    expect(result.profile.identity.firstName).toBe("Ada");
  });
});

describe("learned mappings", () => {
  let store;
  beforeEach(() => ({ store } = freshStore()));

  it("stores and retrieves a mapping for a site", async () => {
    await store.learnMapping("https://acme.myworkdayjobs.com/job/123", "sig-abc", "identity.firstName");
    const mappings = await store.getMappingsFor("https://acme.myworkdayjobs.com/another/page");
    expect(mappings["sig-abc"]).toBe("identity.firstName");
  });

  it("does not leak a mapping to a different site", async () => {
    // The whole reason mappings are per-domain: a correction made on one job
    // board must not mis-fill an unrelated one.
    await store.learnMapping("https://jobs.lever.co/acme", "sig-abc", "identity.firstName");
    expect(await store.getMappingsFor("https://boards.greenhouse.io/acme")).toEqual({});
  });

  it("treats different subdomains as different sites", async () => {
    // Workday tenants are per-company subdomains with genuinely different forms.
    await store.learnMapping("https://acme.myworkdayjobs.com/x", "sig", "identity.email");
    expect(await store.getMappingsFor("https://globex.myworkdayjobs.com/x")).toEqual({});
  });

  it("forgets a mapping when passed a null path", async () => {
    await store.learnMapping("https://jobs.lever.co/acme", "sig", "identity.firstName");
    await store.learnMapping("https://jobs.lever.co/acme", "sig", null);
    expect(await store.getMappingsFor("https://jobs.lever.co/acme")).toEqual({});
  });

  it("drops the domain entry once its last mapping is removed", async () => {
    const { store: s, area } = freshStore();
    await s.learnMapping("https://jobs.lever.co/a", "sig", "identity.firstName");
    await s.learnMapping("https://jobs.lever.co/a", "sig", null);
    expect(area._raw().mappings).toEqual({});
  });

  it("ignores an unparseable URL instead of throwing", async () => {
    await expect(store.learnMapping("not a url", "sig", "identity.email")).resolves.toBeUndefined();
  });
});

describe("domainKeyFor", () => {
  it.each([
    ["https://boards.greenhouse.io/acme/jobs/1", "boards.greenhouse.io"],
    ["https://ACME.myworkdayjobs.com/en-US/careers", "acme.myworkdayjobs.com"],
    ["http://localhost:8080/form", "localhost"],
    ["garbage", ""],
    ["", ""],
  ])("%s -> %s", (url, expected) => {
    expect(domainKeyFor(url)).toBe(expected);
  });
});

describe("export and import", () => {
  it("produces a file that carries its own format marker", async () => {
    const { store } = freshStore();
    await store.setValue("identity.firstName", "Ada");
    const exported = await store.exportState();
    expect(exported._format).toBe("jobfill-profile");
    expect(exported.profile.identity.firstName).toBe("Ada");
    expect(exported._note).toMatch(/private/i);
  });

  it("round-trips through export and import", async () => {
    const { store: source } = freshStore();
    await source.setValue("identity.firstName", "Ada");
    await source.setValue("work.1.company", "Second Job");
    await source.saveSettings({ fillDemographics: true });
    const exported = await source.exportState();

    const { store: target } = freshStore();
    await target.importState(exported);

    const profile = await target.getProfile();
    expect(profile.identity.firstName).toBe("Ada");
    expect(profile.work[1].company).toBe("Second Job");
    expect((await target.getSettings()).fillDemographics).toBe(true);
  });

  it("refuses a file that is not a JobFill export", async () => {
    // Picking the wrong JSON file must not silently wipe a real profile.
    const { store } = freshStore();
    await store.setValue("identity.firstName", "Ada");

    await expect(store.importState({ some: "other json" })).rejects.toThrow(/JobFill export/i);
    await expect(store.importState(null)).rejects.toThrow();
    expect((await store.getProfile()).identity.firstName).toBe("Ada"); // untouched
  });

  it("imports an export missing fields added since it was written", async () => {
    const { store } = freshStore();
    const old = { _format: "jobfill-profile", _version: 1, profile: { identity: { firstName: "Ada" } } };
    await store.importState(old);
    const profile = await store.getProfile();
    expect(profile.identity.firstName).toBe("Ada");
    expect(profile.demographics.gender).toBe("Prefer not to say");
  });
});

describe("clearAll", () => {
  it("resets everything to defaults", async () => {
    const { store } = freshStore();
    await store.setValue("identity.firstName", "Ada");
    await store.learnMapping("https://jobs.lever.co/a", "sig", "identity.email");
    await store.saveSnippets([{ id: "1", title: "Why us", body: "..." }]);

    await store.clearAll();

    const state = await store.read();
    expect(state.profile.identity.firstName).toBe("");
    expect(state.mappings).toEqual({});
    expect(state.snippets).toEqual([]);
    expect(state.settings.fillDemographics).toBe(false);
  });
});
