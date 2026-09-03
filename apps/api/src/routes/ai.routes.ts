import { aiCommandRequestSchema, autoDraftRequestSchema } from "@video-editor/shared";
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { validateBody } from "../middleware/validate.js";
import * as aiService from "../services/ai.service.js";

/** Mounted at /api/sequences (mergeParams already set by the parent sequences router mount point). */
export const sequenceAICommandRouter = Router();

sequenceAICommandRouter.post(
  "/:id/ai-command",
  validateBody(aiCommandRequestSchema),
  asyncHandler(async (req, res) => {
    const result = await aiService.runAICommand(req.params.id!, req.user!.id, req.body.message);
    res.json(result);
  })
);

/** Mounted at /api/projects/:id/auto-draft (mergeParams to reach :id). */
export const projectAutoDraftRouter = Router({ mergeParams: true });

projectAutoDraftRouter.post(
  "/",
  validateBody(autoDraftRequestSchema),
  asyncHandler(async (req, res) => {
    const result = await aiService.runAutoDraft(req.params.id!, req.user!.id, req.body);
    res.json(result);
  })
);
