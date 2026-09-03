import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as jobService from "../services/job.service.js";

export const jobsRouter = Router();

jobsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const job = await jobService.getOwnedJob(req.params.id!, req.user!.id);
    res.json({ job });
  })
);
