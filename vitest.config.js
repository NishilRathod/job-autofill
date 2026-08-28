import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The matching engine is pure logic and runs fastest in plain Node, but a
    // handful of tests parse real ATS form HTML into DOM nodes to check field
    // collection. jsdom covers both, so it is the default environment and
    // individual suites do not need per-file annotations.
    environment: "jsdom",
    include: ["test/**/*.test.js"],
    // Everything under src/core is meant to be browser-free and fully covered;
    // the DOM and UI layers are verified by hand against real job forms, which
    // is why they are excluded from the coverage picture rather than faked.
    coverage: {
      include: ["src/core/**/*.js", "src/storage/**/*.js"],
      reporter: ["text", "html"],
    },
  },
});
