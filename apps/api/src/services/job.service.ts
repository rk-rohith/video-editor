import { prisma } from "@video-editor/db";
import { JOB_TYPES } from "@video-editor/shared";
import { NotFoundError } from "../lib/errors.js";

/**
 * Job ownership is resolved through whatever entity refId points at, since
 * Job itself has no direct user/project column (see ARCHITECTURE.md §10).
 */
export async function getOwnedJob(jobId: string, userId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new NotFoundError("Job not found");

  if (job.type === JOB_TYPES.processAsset || job.type === JOB_TYPES.analyzeAsset) {
    const asset = await prisma.asset.findUnique({ where: { id: job.refId }, include: { project: true } });
    if (!asset || asset.project.userId !== userId) throw new NotFoundError("Job not found");
  } else if (job.type === JOB_TYPES.render) {
    const render = await prisma.render.findUnique({ where: { id: job.refId }, include: { project: true } });
    if (!render || render.project.userId !== userId) throw new NotFoundError("Job not found");
  } else {
    throw new NotFoundError("Job not found");
  }
  return job;
}
