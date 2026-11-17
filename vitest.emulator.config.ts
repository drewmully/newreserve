import path from "path";
import { defineConfig } from "vitest/config";

// Firebase Auth emulator tests. They need the Auth emulator, so they are NOT
// part of the default `vitest run` projects. Run with:
//   npm run test:auth-emulator
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/emulator/**/*.emulator.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
