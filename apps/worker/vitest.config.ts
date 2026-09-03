import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// See apps/api/vitest.config.ts for why this injects env via `test.env`
// rather than relying on import-order side effects.
const parsed = dotenv.config({ path: ".env.test" }).parsed ?? {};

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    env: { ...parsed, NODE_ENV: "test" },
    testTimeout: 30000,
  },
});
