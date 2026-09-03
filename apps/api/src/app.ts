import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "node:path";
import { env } from "./env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.routes.js";
import { projectAssetsRouter, assetsRouter } from "./routes/assets.routes.js";
import { projectRendersRouter, rendersRouter } from "./routes/renders.routes.js";
import { jobsRouter } from "./routes/jobs.routes.js";
import { projectsRouter } from "./routes/projects.routes.js";
import { sequencesRouter } from "./routes/sequences.routes.js";
import { storageUploadRouter } from "./routes/storage.routes.js";
import { projectAutoDraftRouter, sequenceAICommandRouter } from "./routes/ai.routes.js";

export function createApp(): Express {
  const app = express();
  app.use(
    helmet({
      // The web app (a different origin in dev, and typically a different
      // subdomain/CDN in production) loads media directly from /storage —
      // <video>/<img>/<canvas> element access requires the resource policy
      // to allow cross-origin reads. Access itself is still governed by the
      // `cors` middleware below (restricted to CORS_ORIGIN).
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

  // Mounted BEFORE express.json() — this route streams the raw upload body
  // to disk itself and must not have the body consumed/parsed first.
  app.use(storageUploadRouter);

  if (env.STORAGE_DRIVER === "local" && env.STORAGE_LOCAL_ROOT) {
    app.use("/storage", express.static(path.resolve(env.STORAGE_LOCAL_ROOT)));
  }

  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const jobCreationLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  // AI calls cost real money per request (ARCHITECTURE.md §25/§32) — a
  // tighter limit than ordinary job creation.
  const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

  app.use("/api/auth", authLimiter, authRouter);

  app.use("/api/projects", requireAuth, projectsRouter);
  app.use("/api/projects/:id/assets", requireAuth, jobCreationLimiter, projectAssetsRouter);
  app.use("/api/projects/:id/renders", requireAuth, jobCreationLimiter, projectRendersRouter);
  app.use("/api/projects/:id/auto-draft", requireAuth, aiLimiter, projectAutoDraftRouter);
  app.use("/api/assets", requireAuth, assetsRouter);
  app.use("/api/sequences", requireAuth, sequencesRouter);
  app.use("/api/sequences", requireAuth, aiLimiter, sequenceAICommandRouter);
  app.use("/api/renders", requireAuth, rendersRouter);
  app.use("/api/jobs", requireAuth, jobsRouter);

  app.use(errorHandler);
  return app;
}
