import { applyTimelineOperationsRequestSchema } from "@video-editor/shared";
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { validateBody } from "../middleware/validate.js";
import * as sequenceService from "../services/sequence.service.js";

export const sequencesRouter = Router();

sequencesRouter.patch(
  "/:id/timeline",
  validateBody(applyTimelineOperationsRequestSchema),
  asyncHandler(async (req, res) => {
    const version = await sequenceService.applyTimelineOperations(req.params.id!, req.user!.id, req.body);
    res.json({ timelineVersion: version });
  })
);

sequencesRouter.get(
  "/:id/versions",
  asyncHandler(async (req, res) => {
    const versions = await sequenceService.listVersions(req.params.id!, req.user!.id);
    res.json({ versions });
  })
);

sequencesRouter.post(
  "/:id/versions/:versionId/restore",
  asyncHandler(async (req, res) => {
    const version = await sequenceService.restoreVersion(req.params.id!, req.params.versionId!, req.user!.id);
    res.json({ timelineVersion: version });
  })
);
