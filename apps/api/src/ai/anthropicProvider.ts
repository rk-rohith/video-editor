import Anthropic from "@anthropic-ai/sdk";
import { aiEditPlanSchema, ticksToSeconds, type AIEditPlan } from "@video-editor/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AIProvider, AssetContext, PlanEditInput } from "./types.js";

const TOOL_NAME = "apply_timeline_operations";

/**
 * The tool's input schema is generated FROM the same Zod schema
 * (packages/shared/src/ai.ts -> operations.ts) the backend validates the
 * response against, rather than hand-duplicated — so the set of operations
 * the model can propose can never drift out of sync with the set the
 * backend actually accepts.
 */
export function buildToolInputSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(aiEditPlanSchema, { target: "openApi3", $refStrategy: "none" });
  delete (schema as Record<string, unknown>).$schema;
  return schema as Record<string, unknown>;
}

function summarizeAsset(asset: AssetContext): string {
  const durationSeconds = asset.durationTicks !== null ? `${ticksToSeconds(asset.durationTicks).toFixed(1)}s` : "unknown duration";
  const dims = asset.width && asset.height ? `${asset.width}x${asset.height}` : "unknown dimensions";
  const parts = [`id=${asset.id}`, asset.kind, durationSeconds, dims, asset.originalName ? `"${asset.originalName}"` : ""];

  if (asset.analysis?.kind === "video") {
    parts.push(
      `quality=${asset.analysis.qualityScore.toFixed(2)}`,
      `stability=${asset.analysis.stability}`,
      `recommended=${asset.analysis.recommendedUsage}`,
      `bestSegment=${ticksToSeconds(asset.analysis.bestSegment.startTicks).toFixed(1)}-${ticksToSeconds(asset.analysis.bestSegment.endTicks).toFixed(1)}s`
    );
  } else if (asset.analysis?.kind === "image") {
    parts.push(`quality=${asset.analysis.qualityScore.toFixed(2)}`, `orientation=${asset.analysis.orientation}`, `colors=${asset.analysis.dominantColors.join(",")}`);
    if (asset.analysis.duplicateOfAssetIds.length > 0) parts.push(`possible-duplicate-of=${asset.analysis.duplicateOfAssetIds.join(",")}`);
  }
  return parts.filter(Boolean).join(" | ");
}

function buildSystemPrompt(): string {
  return [
    "You are the editing assistant inside a professional non-linear video editor.",
    "You NEVER edit the timeline directly. You only propose a call to the apply_timeline_operations tool,",
    "whose `operations` array is built ONLY from the closed set of operations described in that tool's schema.",
    "Every clip/text/audio id you reference in an operation MUST already exist in the CURRENT SEQUENCE JSON given to you,",
    "except for ids YOU invent for newly inserted clips/text/audio layers (invent short unique string ids for those).",
    "Every `sourceAssetId` you use in insertClip/replaceClip/addAudio MUST be one of the asset ids listed under AVAILABLE ASSETS.",
    "Time values are in ticks: 600 ticks = 1 second (see TICKS_PER_SECOND).",
    "Prefer assets whose analysis marks them higher quality and whose `recommended` usage matches the role you're placing them in.",
    "Keep your `explanation` short (1-3 sentences) and written for a non-technical video editor, describing what you changed and why.",
    "If the request cannot be fulfilled with the available assets (e.g. no suitable clip exists), still return a plan for what IS",
    "possible and say so plainly in the explanation — never invent an asset id that doesn't exist.",
  ].join(" ");
}

function buildUserPrompt(input: PlanEditInput): string {
  const assetLines = input.assets.length > 0 ? input.assets.map((a) => `- ${summarizeAsset(a)}`).join("\n") : "(no ready assets in this project yet)";
  return [
    `CURRENT SEQUENCE JSON:\n${JSON.stringify(input.sequence)}`,
    `\nAVAILABLE ASSETS:\n${assetLines}`,
    `\nTICKS_PER_SECOND: 600`,
    `\nUSER REQUEST:\n${input.instruction}`,
  ].join("\n");
}

export class AnthropicAIProvider implements AIProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async planEdit(input: PlanEditInput): Promise<AIEditPlan> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserPrompt(input) }],
      tools: [
        {
          name: TOOL_NAME,
          description: "Apply a batch of validated timeline operations to the current sequence, with a short human-readable explanation.",
          input_schema: buildToolInputSchema() as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (!toolUse) {
      throw new Error("AI response did not include the expected tool call");
    }
    return aiEditPlanSchema.parse(toolUse.input);
  }
}
