import { QUEUE_NAMES } from "@video-editor/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";

/**
 * The worker process also needs to ENQUEUE jobs, not just process them:
 * processAssetJob chains into the analysis queue once an asset's metadata
 * is known good (see processors/processAsset.ts) rather than having the
 * API enqueue both jobs up front and risk analyzeAssetJob reading
 * not-yet-populated width/height/duration.
 */
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const analysisQueue = new Queue(QUEUE_NAMES.analysis, { connection });
