import { env } from "../env.js";
import { AnthropicAIProvider } from "./anthropicProvider.js";
import { NotConfiguredAIProvider } from "./notConfiguredProvider.js";
import type { AIProvider } from "./types.js";

export * from "./types.js";

export function createAIProvider(): AIProvider {
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicAIProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
  }
  return new NotConfiguredAIProvider();
}

/** A single shared instance — created once at module load, matching how the storage provider and BullMQ queues are wired. */
export const aiProvider = createAIProvider();
