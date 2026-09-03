import { registerAssetRequestSchema, requestUploadUrlSchema } from "@video-editor/shared";
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { validateBody } from "../middleware/validate.js";
import * as assetService from "../services/asset.service.js";

/** Mounted at /api/projects/:id/assets (mergeParams to reach :id). */
export const projectAssetsRouter = Router({ mergeParams: true });

projectAssetsRouter.post(
  "/upload-url",
  validateBody(requestUploadUrlSchema),
  asyncHandler(async (req, res) => {
    const result = await assetService.requestUploadUrl(req.params.id!, req.user!.id, req.body);
    res.json(result);
  })
);

projectAssetsRouter.post(
  "/",
  validateBody(registerAssetRequestSchema),
  asyncHandler(async (req, res) => {
    const result = await assetService.registerAsset(req.params.id!, req.user!.id, req.body);
    res.status(201).json(result);
  })
);

projectAssetsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const assets = await assetService.listAssets(req.params.id!, req.user!.id);
    res.json({ assets });
  })
);

/** Mounted at /api/assets. */
export const assetsRouter = Router();

assetsRouter.delete(
  "/:assetId",
  asyncHandler(async (req, res) => {
    await assetService.deleteAsset(req.params.assetId!, req.user!.id);
    res.status(204).end();
  })
);

assetsRouter.get(
  "/:assetId/analysis",
  asyncHandler(async (req, res) => {
    const analysis = await assetService.getAssetAnalysis(req.params.assetId!, req.user!.id);
    res.json({ analysis });
  })
);
