import { QUEUE_NAMES } from "@video-editor/shared";
import { Queue } from "bullmq";
import { redisConnection } from "../lib/redis.js";

/**
 * Two queues (see ARCHITECTURE.md §12): media-processing for fast per-asset
 * work (proxy/thumbnail/waveform/metadata) and render for the slow,
 * user-triggered export job — kept separate so a long render never starves
 * proxy generation a user is actively waiting on in the editor.
 */
export const mediaProcessingQueue = new Queue(QUEUE_NAMES.mediaProcessing, { connection: redisConnection });
export const renderQueue = new Queue(QUEUE_NAMES.render, { connection: redisConnection });
