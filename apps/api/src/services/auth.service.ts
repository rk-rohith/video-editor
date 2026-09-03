import { prisma } from "@video-editor/db";
import type { LoginRequest, RegisterRequest } from "@video-editor/shared";
import { ConflictError, HttpError } from "../lib/errors.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";

async function issueTokens(user: { id: string; email: string }) {
  return {
    accessToken: signAccessToken({ sub: user.id, email: user.email }),
    refreshToken: signRefreshToken({ sub: user.id }),
  };
}

export async function register(input: RegisterRequest) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError("An account with this email already exists");

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, name: input.name },
  });
  const tokens = await issueTokens(user);
  return { user: { id: user.id, email: user.email, name: user.name }, ...tokens };
}

export async function login(input: LoginRequest) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new HttpError(401, "Invalid email or password");
  }
  const tokens = await issueTokens(user);
  return { user: { id: user.id, email: user.email, name: user.name }, ...tokens };
}

export async function refresh(refreshToken: string) {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new HttpError(401, "Invalid or expired refresh token");
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw new HttpError(401, "User no longer exists");
  return issueTokens(user);
}
