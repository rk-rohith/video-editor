import jwt from "jsonwebtoken";
import { env } from "../env.js";
import { parseDurationToSeconds } from "./duration.js";

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
}

const accessTtlSeconds = parseDurationToSeconds(env.JWT_ACCESS_TTL);
const refreshTtlSeconds = parseDurationToSeconds(env.JWT_REFRESH_TTL);

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: accessTtlSeconds });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function signRefreshToken(payload: { sub: string }): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: refreshTtlSeconds });
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
}
