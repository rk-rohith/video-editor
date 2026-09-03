import { QUEUE_NAMES } from "@video-editor/shared";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";
import { analyzeAssetJob } from "./processors/analyzeAsset.js";
import { processAssetJob } from "./processors/processAsset.js";
import { runRenderJob } from "./render/runRender.js";

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const mediaProcessingWorker = new Worker(QUEUE_NAMES.mediaProcessing, processAssetJob, {
  connection,
  concurrency: 2,
});

const analysisWorker = new Worker(QUEUE_NAMES.analysis, analyzeAssetJob, {
  connection,
  concurrency: 2,
});

const renderWorker = new Worker(QUEUE_NAMES.render, runRenderJob, {
  connection,
  concurrency: 1, // renders are CPU-heavy; keep serialized in Phase 1's single-worker deployment
});

for (const worker of [mediaProcessingWorker, analysisWorker, renderWorker]) {
  worker.on("completed", (job) => console.log(`[${worker.name}] job ${job.id} completed`));
  worker.on("failed", (job, err) => console.error(`[${worker.name}] job ${job?.id} failed:`, err.message));
}

console.log("Worker process started, listening for media-processing, analysis, and render jobs.");

async function shutdown() {
  await Promise.all([mediaProcessingWorker.close(), analysisWorker.close(), renderWorker.close()]);
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
