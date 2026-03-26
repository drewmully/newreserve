import { afterEach, beforeEach, vi } from "vitest";

const BASE_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, BASE_ENV);
}

beforeEach(() => {
  resetEnv();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetEnv();
  vi.clearAllMocks();
  vi.resetModules();
});
