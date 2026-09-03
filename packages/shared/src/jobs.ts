/** Job/queue type constants shared by apps/api (enqueues) and apps/worker (processes). See ARCHITECTURE.md §12. */
export const JOB_TYPES = {
  processAsset: "process-asset",
  render: "render",
} as const;
export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export const QUEUE_NAMES = {
  mediaProcessing: "media-processing",
  render: "render",
} as const;

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
