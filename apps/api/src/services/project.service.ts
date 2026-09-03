import { prisma } from "@video-editor/db";
import { createEmptySequence, type CreateProjectRequest, type UpdateProjectRequest } from "@video-editor/shared";
import { NotFoundError } from "../lib/errors.js";
import { createId } from "../lib/id.js";

const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

/** Throws NotFoundError if the project doesn't exist or isn't owned by `userId` — the single ownership choke point. */
export async function getOwnedProject(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.userId !== userId) {
    throw new NotFoundError("Project not found");
  }
  return project;
}

export async function listProjects(userId: string) {
  return prisma.project.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
}

export async function createProject(userId: string, input: CreateProjectRequest) {
  const dimensions = ASPECT_RATIO_DIMENSIONS[input.aspectRatio] ?? ASPECT_RATIO_DIMENSIONS["9:16"]!;
  const project = await prisma.project.create({
    data: {
      userId,
      name: input.name,
      aspectRatio: input.aspectRatio,
      targetDurationTicks: input.targetDurationTicks,
    },
  });

  // Every project starts with one empty, editable sequence — the manual
  // editor always has somewhere to land, per product principle #45.
  const sequence = await prisma.sequence.create({
    data: { projectId: project.id, name: "Main Sequence" },
  });
  const initialTimeline = createEmptySequence({
    id: createId(),
    projectId: project.id,
    width: dimensions.width,
    height: dimensions.height,
  });
  const version = await prisma.timelineVersion.create({
    data: {
      sequenceId: sequence.id,
      label: "Original",
      data: initialTimeline,
      createdBy: "user",
    },
  });
  await prisma.sequence.update({ where: { id: sequence.id }, data: { currentVersionId: version.id } });

  return project;
}

export async function updateProject(projectId: string, userId: string, input: UpdateProjectRequest) {
  await getOwnedProject(projectId, userId);
  return prisma.project.update({ where: { id: projectId }, data: input });
}

export async function deleteProject(projectId: string, userId: string, deleteObjectFn: (key: string) => Promise<void>) {
  const project = await getOwnedProject(projectId, userId);
  const assets = await prisma.asset.findMany({ where: { projectId: project.id } });
  await Promise.all(
    assets.flatMap((asset) =>
      [asset.originalKey, asset.proxyKey, asset.thumbnailKey, asset.waveformKey]
        .filter((key): key is string => Boolean(key))
        .map((key) => deleteObjectFn(key).catch(() => undefined))
    )
  );
  await prisma.project.delete({ where: { id: project.id } });
}
