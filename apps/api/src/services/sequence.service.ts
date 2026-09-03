import { prisma } from "@video-editor/db";
import { applyOperations, OperationError, sequenceSchema, type ApplyTimelineOperationsRequest } from "@video-editor/shared";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

export async function getOwnedSequence(sequenceId: string, userId: string) {
  const sequence = await prisma.sequence.findUnique({ where: { id: sequenceId }, include: { project: true } });
  if (!sequence || sequence.project.userId !== userId) throw new NotFoundError("Sequence not found");
  return sequence;
}

/**
 * Applies a validated batch of timeline operations to a sequence's current
 * version, producing exactly ONE new TimelineVersion row — see
 * ARCHITECTURE.md §18/§22/§29. This is the single choke point every
 * timeline mutation passes through, manual or (from Phase 2) AI-driven.
 */
export async function applyTimelineOperations(
  sequenceId: string,
  userId: string,
  input: ApplyTimelineOperationsRequest
) {
  const sequence = await getOwnedSequence(sequenceId, userId);
  if (!sequence.currentVersionId) throw new BadRequestError("Sequence has no current version");
  const currentVersion = await prisma.timelineVersion.findUnique({ where: { id: sequence.currentVersionId } });
  if (!currentVersion) throw new BadRequestError("Sequence's current version is missing");

  const currentData = sequenceSchema.parse(currentVersion.data);
  let nextData;
  try {
    nextData = applyOperations(currentData, input.operations);
  } catch (err) {
    if (err instanceof OperationError) throw new BadRequestError(err.message);
    throw err;
  }
  const validated = sequenceSchema.parse(nextData);

  const newVersion = await prisma.timelineVersion.create({
    data: {
      sequenceId,
      label: input.label,
      data: validated,
      createdBy: "user",
      parentVersionId: currentVersion.id,
    },
  });
  await prisma.sequence.update({ where: { id: sequenceId }, data: { currentVersionId: newVersion.id } });
  return newVersion;
}

export async function listVersions(sequenceId: string, userId: string) {
  await getOwnedSequence(sequenceId, userId);
  return prisma.timelineVersion.findMany({ where: { sequenceId }, orderBy: { createdAt: "desc" } });
}

export async function restoreVersion(sequenceId: string, versionId: string, userId: string) {
  await getOwnedSequence(sequenceId, userId);
  const version = await prisma.timelineVersion.findUnique({ where: { id: versionId } });
  if (!version || version.sequenceId !== sequenceId) throw new NotFoundError("Timeline version not found");
  await prisma.sequence.update({ where: { id: sequenceId }, data: { currentVersionId: version.id } });
  return version;
}
