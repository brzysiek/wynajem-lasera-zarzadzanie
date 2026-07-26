import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/prisma";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// The raw token goes in the email link; only its hash is stored, so a
// database read (backup leak, etc.) can't be used to reset someone's
// password — same reasoning as storing passwordHash instead of passwordHash.
export function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function createResetToken(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");

  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  return rawToken;
}

// NEXTAUTH_URL is intentionally the plain origin with no /wynajem suffix
// (see src/auth.ts) — basePath must be added back by hand here, same as
// BASE_PATH in src/proxy.ts and the nextauth route handler.
export function buildResetUrl(rawToken: string): string {
  const origin = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${origin}/wynajem/reset-password?token=${rawToken}`;
}
