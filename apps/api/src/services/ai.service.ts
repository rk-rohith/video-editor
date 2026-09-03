import { prisma } from "@video-editor/db";
import { assetAnalysisDataSchema, secondsToTicks, type AIEditPlan, type AutoDraftRequest } from "@video-editor/shared";
import { aiProvider, AIProviderNotConfiguredError, type AssetContext, type PlanEditInput } from "../ai/index.js";
import { BadRequestError, NotFoundError, ServiceUnavailableError } from "../lib/errors.js";
import { getOwnedProject } from "./project.service.js";
import { applyTimelineOperations, getCurrentSequenceData, getOwnedSequence } from "./sequence.service.js";

async function planEdit(input: PlanEditInput): Promise<AIEditPlan> {
  try {
    return await aiProvider.planEdit(input);
  } catch (err) {
    if (err instanceof AIProviderNotConfiguredError) throw new ServiceUnavailableError(err.message);
    throw err;
  }
}

async function loadAssetContext(projectId: string, assetIds?: string[]): Promise<AssetContext[]> {
  const assets = await prisma.asset.findMany({
    where: { projectId, status: "ready", ...(assetIds ? { id: { in: assetIds } } : {}) },
    include: { analysis: true },
  });
  return assets.map((asset) => {
    const parsed = asset.analysis ? assetAnalysisDataSchema.safeParse(asset.analysis.data) : null;
    return {
      id: asset.id,
      kind: asset.kind as "video" | "image" | "audio",
      originalName: asset.originalName,
      durationTicks: asset.durationTicks,
      width: asset.width,
      height: asset.height,
      analysis: parsed?.success ? parsed.data : null,
    };
  });
}

/** Natural-language chat editing — the user's message is sent to the AI verbatim against the sequence's current state. See ARCHITECTURE.md §18. */
export async function runAICommand(sequenceId: string, userId: string, message: string) {
  const sequence = await getOwnedSequence(sequenceId, userId);
  const sequenceData = await getCurrentSequenceData(sequenceId, userId);
  const assets = await loadAssetContext(sequence.projectId);

  const plan = await planEdit({ sequence: sequenceData, assets, instruction: message });
  if (plan.operations.length === 0) {
    return { timelineVersion: null, explanation: plan.explanation };
  }
  const timelineVersion = await applyTimelineOperations(sequenceId, userId, { operations: plan.operations, label: message.slice(0, 120) }, "ai");
  return { timelineVersion, explanation: plan.explanation };
}

/**
 * Prompt-to-first-draft (ARCHITECTURE.md §6/§18): builds a server-side
 * instruction that asks the model to construct a complete edit from
 * scratch using the project's assets, then routes through the exact same
 * planEdit + applyTimelineOperations path as chat editing — no separate
 * "auto-edit" machinery, just a richer instruction.
 */
export async function runAutoDraft(projectId: string, userId: string, input: AutoDraftRequest) {
  await getOwnedProject(projectId, userId);
  const sequence = await prisma.sequence.findFirst({ where: { projectId } });
  if (!sequence) throw new NotFoundError("Project has no sequence");

  const assets = await loadAssetContext(projectId, input.assetIds);
  if (assets.length === 0) {
    throw new BadRequestError("This project has no ready assets to build a draft from yet — upload and wait for processing to finish first.");
  }

  const sequenceData = await getCurrentSequenceData(sequence.id, userId);
  const targetDurationTicks = input.targetDurationSeconds ? secondsToTicks(input.targetDurationSeconds) : undefined;

  const instruction = [
    "Build a complete first-draft edit from scratch on the primary video track, using the assets listed under AVAILABLE ASSETS.",
    "Follow this structure unless the style clearly calls for something else: a short hook, an establishing/context section, a middle section",
    "showcasing the subject, and a closing/CTA moment. Use insertClip for each shot, addTransition for cuts between them where it suits the pace,",
    "and addText for a title and/or a closing call-to-action if appropriate for the style.",
    targetDurationTicks ? `Target a total duration of about ${input.targetDurationSeconds} seconds.` : "Choose a reasonable total duration for the style.",
    `Requested style: ${input.prompt}`,
  ].join(" ");

  const plan = await planEdit({ sequence: sequenceData, assets, instruction });
  const timelineVersion = await applyTimelineOperations(sequence.id, userId, { operations: plan.operations, label: `AI draft: ${input.prompt.slice(0, 100)}` }, "ai");
  return { timelineVersion, explanation: plan.explanation };
}
