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
          include: ["tests/api/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/setup/api.setup.ts"],
        },
      }),
    ],
  },
});
