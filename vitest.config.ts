import path from "path";
import { defineConfig, defineProject } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
    projects: [
      defineProject({
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
          },
        },
        test: {
          name: "ui",
          include: ["tests/ui/**/*.test.ts", "tests/ui/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["tests/setup/ui.setup.ts"],
        },
      }),
      defineProject({
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
          },
        },
        test: {
          name: "api",
          include: ["tests/api/**/*.test.ts", "tests/events/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/setup/api.setup.ts"],
        },
      }),
      defineProject({
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
          },
        },
        test: {
          name: "lib",
          // Wire in tests/lib for the retry-wrapper unit tests. The
          // pre-existing tests/lib/golfStats.test.ts is excluded here — it
          // predates any project wiring (see PR #129 discussion) and has a
          // known WHS-cap assertion failure that is out of scope for this PR.
          include: [
            "tests/lib/loopAdminRetry.test.ts",
            "tests/lib/shopifyRetry.test.ts",
          ],
          environment: "node",
          setupFiles: ["tests/setup/api.setup.ts"],
        },
      }),
    ],
  },
});
