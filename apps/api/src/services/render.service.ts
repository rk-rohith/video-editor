import { prisma } from "@video-editor/db";
import { JOB_TYPES, PLATFORM_PRESETS, type CreateRenderRequest } from "@video-editor/shared";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { renderQueue } from "../queues/queues.js";
import { getOwnedProject } from "./project.service.js";

export async function createRender(projectId: string, userId: string, input: CreateRenderRequest) {
  await getOwnedProject(projectId, userId);
  const timelineVersion = await prisma.timelineVersion.findUnique({ where: { id: input.timelineVersionId } });
  if (!timelineVersion) throw new BadRequestError("Timeline version not found");
  const sequence = await prisma.sequence.findUnique({ where: { id: timelineVersion.sequenceId } });
  if (!sequence || sequence.projectId !== projectId) {
    throw new BadRequestError("Timeline version does not belong to this project");
  }

  const preset = input.platformPreset !== "custom" ? PLATFORM_PRESETS[input.platformPreset] : undefined;

  const render = await prisma.render.create({
    data: {
      projectId,
      timelineVersionId: timelineVersion.id,
      format: input.format,
      resolution: preset?.resolution ?? input.resolution,
      fps: preset?.fps ?? input.fps,
      status: "queued",
    },
  });
  const job = await prisma.job.create({ data: { type: JOB_TYPES.render, refId: render.id, status: "queued" } });
  await prisma.render.update({ where: { id: render.id }, data: { jobId: job.id } });
  await renderQueue.add(JOB_TYPES.render, { renderId: render.id, jobId: job.id }, { jobId: job.id });

  return { render, jobId: job.id };
}

export async function getOwnedRender(renderId: string, userId: string) {
  const render = await prisma.render.findUnique({ where: { id: renderId }, include: { project: true } });
  if (!render || render.project.userId !== userId) throw new NotFoundError("Render not found");
  return render;
}
