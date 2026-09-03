import { createRenderRequestSchema } from "@video-editor/shared";
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { validateBody } from "../middleware/validate.js";
import * as renderService from "../services/render.service.js";
import { storage } from "../lib/storage.js";

/** Mounted at /api/projects/:id/renders (mergeParams to reach :id). */
export const projectRendersRouter = Router({ mergeParams: true });

projectRendersRouter.post(
  "/",
  validateBody(createRenderRequestSchema),
  asyncHandler(async (req, res) => {
    const result = await renderService.createRender(req.params.id!, req.user!.id, req.body);
    res.status(201).json(result);
  })
);

/** Mounted at /api/renders. */
export const rendersRouter = Router();

rendersRouter.get(
  "/:renderId",
  asyncHandler(async (req, res) => {
    const render = await renderService.getOwnedRender(req.params.renderId!, req.user!.id);
    res.json({ render: { ...render, outputUrl: render.outputKey ? storage.getObjectUrl(render.outputKey) : null } });
  })
);
