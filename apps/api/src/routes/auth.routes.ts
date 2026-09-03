import { loginRequestSchema, registerRequestSchema } from "@video-editor/shared";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler.js";
import { validateBody } from "../middleware/validate.js";
import * as authService from "../services/auth.service.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  validateBody(registerRequestSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  })
);

authRouter.post(
  "/login",
  validateBody(loginRequestSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    res.json(result);
  })
);

const refreshRequestSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post(
  "/refresh",
  validateBody(refreshRequestSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.refresh(req.body.refreshToken);
    res.json(result);
  })
);

authRouter.post("/logout", (_req, res) => {
  // Stateless JWT — logout is a client-side token discard. A refresh-token
  // denylist (Redis-backed) is the natural upgrade if/when session
  // revocation becomes a requirement; not needed for the Phase 1 MVP.
  res.status(204).end();
});
