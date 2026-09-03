import type { AIEditPlan, AssetAnalysisData, Sequence } from "@video-editor/shared";

/** What the AI is shown about each candidate asset — enough to reason about matching, not raw pixels (see ARCHITECTURE.md §32 cost-aware design). */
export interface AssetContext {
  id: string;
  kind: "video" | "image" | "audio";
  originalName: string | null;
  durationTicks: number | null;
  width: number | null;
  height: number | null;
  analysis: AssetAnalysisData | null;
}

export interface PlanEditInput {
  /** The current timeline — the model edits THIS, not a blank slate, even for an auto-draft (which starts from the project's empty initial sequence). */
  sequence: Sequence;
  /** Every ready asset in the project the model is allowed to reference by id. */
  assets: AssetContext[];
  /** The user's request, verbatim for chat edits; a server-constructed brief for auto-draft (see ai.service.ts). */
  instruction: string;
}

/**
 * Every concrete AI backend implements this one method. It must return
 * operations from the SAME closed set the manual editor uses
 * (packages/shared/src/operations.ts) — never touch application state
 * directly. See ARCHITECTURE.md §18/§29.
 */
export interface AIProvider {
  readonly name: string;
  planEdit(input: PlanEditInput): Promise<AIEditPlan>;
}

export class AIProviderNotConfiguredError extends Error {
  constructor(message = "AI features require ANTHROPIC_API_KEY to be configured on the server.") {
    super(message);
  }
}
