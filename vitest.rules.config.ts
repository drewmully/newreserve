import { defineConfig } from "vitest/config";

// Firestore security-rules tests. They need the Firestore emulator, so they
// are NOT part of the default `vitest run` projects. Run with:
//   npm run test:rules
export default defineConfig({
  test: {
    include: ["tests/rules/**/*.rules.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
