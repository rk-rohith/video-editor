import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Load .env.test into THIS config-evaluation process and hand the values to
// vitest's `test.env`, so every test worker has DATABASE_URL etc. present
// before it evaluates any import — including the `@video-editor/db` Prisma
// singleton, which reads DATABASE_URL at construction time. Relying on
// import order for this (e.g. an env.ts loaded as a side effect somewhere
// in the graph) is fragile; injecting via `test.env` is not.
const parsed = dotenv.config({ path: ".env.test" }).parsed ?? {};

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    env: { ...parsed, NODE_ENV: "test" },
  },
});
