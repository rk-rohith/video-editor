import { prisma } from "@video-editor/db";
import { createProjectRequestSchema, updateProjectRequestSchema } from "@video-editor/shared";
import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { validateBody } from "../middleware/validate.js";
import * as projectService from "../services/project.service.js";
import { storage } from "../lib/storage.js";

export const projectsRouter = Router();

projectsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const projects = await projectService.listProjects(req.user!.id);
    res.json({ projects });
  })
);

projectsRouter.post(
  "/",
  validateBody(createProjectRequestSchema),
  asyncHandler(async (req, res) => {
    const project = await projectService.createProject(req.user!.id, req.body);
    res.status(201).json({ project });
  })
);

projectsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await projectService.getOwnedProject(req.params.id!, req.user!.id);
    res.json({ project });
  })
);

projectsRouter.patch(
  "/:id",
  validateBody(updateProjectRequestSchema),
  asyncHandler(async (req, res) => {
    const project = await projectService.updateProject(req.params.id!, req.user!.id, req.body);
    res.json({ project });
  })
);

projectsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await projectService.deleteProject(req.params.id!, req.user!.id, (key) => storage.deleteObject(key));
    res.status(204).end();
  })
);

/** Current sequence + its latest timeline version, for the editor to load on open. */
projectsRouter.get(
  "/:id/sequence",
  asyncHandler(async (req, res) => {
    await projectService.getOwnedProject(req.params.id!, req.user!.id);
    const sequence = await prisma.sequence.findFirst({ where: { projectId: req.params.id! } });
    if (!sequence) {
      res.status(404).json({ error: "Sequence not found" });
      return;
    }
    const version = sequence.currentVersionId
      ? await prisma.timelineVersion.findUnique({ where: { id: sequence.currentVersionId } })
      : null;
    res.json({ sequence, timelineVersion: version });
  })
);
