import { Router } from "express";
import { localStorage } from "../lib/storage.js";

/**
 * Dev-only local storage endpoints. In production (STORAGE_DRIVER=s3) the
 * browser uploads directly to S3 via a presigned URL and this route never
 * exists — see ARCHITECTURE.md §13/§26. Mounted BEFORE any JSON body
 * parser so the raw upload stream reaches writeUploadStream untouched.
 */
export const storageUploadRouter = Router();

storageUploadRouter.put("/storage-upload/:token", async (req, res) => {
  if (!localStorage) {
    res.status(400).json({ error: "Local storage upload is only available when STORAGE_DRIVER=local" });
    return;
  }
  try {
    const { key } = localStorage.verifyToken(req.params.token!);
    await localStorage.writeUploadStream(key, req);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
  }
});
