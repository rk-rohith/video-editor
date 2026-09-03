import type { AIProvider, PlanEditInput } from "./types.js";
import { AIProviderNotConfiguredError } from "./types.js";

/**
 * The honest default when no ANTHROPIC_API_KEY is set: fails loudly and
 * clearly instead of silently no-oping or fabricating a plan. Per the
 * project's own rule — "explicitly explain the limitation... instead of
 * pretending it works" — this is the correct behavior for an
 * unconfigured deployment, not a bug to work around.
 */
export class NotConfiguredAIProvider implements AIProvider {
  readonly name = "not-configured";

  async planEdit(_input: PlanEditInput): Promise<never> {
    throw new AIProviderNotConfiguredError();
  }
}
