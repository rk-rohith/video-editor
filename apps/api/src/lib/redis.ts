import { Redis } from "ioredis";
import { env } from "../env.js";

/** BullMQ requires maxRetriesPerRequest: null on the shared connection it's given. */
export const redisConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
