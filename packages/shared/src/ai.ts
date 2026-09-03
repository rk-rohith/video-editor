import { z } from "zod";
import { operationSchema } from "./operations.js";

/**
 * Natural-language editing contracts (ARCHITECTURE.md §18/§29). The model
 * never touches the Sequence directly — it can only return a plan made of
 * operations from the same closed set the manual editor uses
 * (packages/shared/src/operations.ts), which the backend then validates and
 * applies exactly like a user-driven PATCH. This file has no dependency on
 * any AI SDK — it's pure data shape, shared by the API (which calls the
 * provider) and the web app (which renders the result).
 */

export const aiCommandRequestSchema = z.object({
  message: z.string().min(1).max(2000),
});
export type AICommandRequest = z.infer<typeof aiCommandRequestSchema>;

/** The one shape every AIProvider call must resolve to: a validated operation batch plus a human-readable explanation. */
export const aiEditPlanSchema = z.object({
  operations: z.array(operationSchema).max(200),
  explanation: z.string().max(2000),
});
export type AIEditPlan = z.infer<typeof aiEditPlanSchema>;

export const autoDraftRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  targetDurationSeconds: z.number().min(3).max(600).optional(),
  assetIds: z.array(z.string()).max(200).optional(),
});
export type AutoDraftRequest = z.infer<typeof autoDraftRequestSchema>;
