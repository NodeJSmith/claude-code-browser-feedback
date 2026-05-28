import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: {
        "src/widget/**": {
          statements: 75,
          branches: 55,
          functions: 65,
          lines: 75,
        },
      },
    },
  },
});
