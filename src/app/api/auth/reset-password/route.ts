import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { hashResetToken } from "@/lib/password-reset";
import { logInfo } from "@/lib/logger";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!token) {
    return NextResponse.json({ message: "Brak tokenu resetu hasła." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { message: `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.` },
      { status: 400 },
    );
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
  });

  const isValid = resetToken && !resetToken.usedAt && resetToken.expiresAt > new Date();
  if (!isValid) {
    logInfo("password_reset_invalid_token", { tokenId: resetToken?.id ?? null });
    return NextResponse.json(
      { message: "Link do resetu hasła jest nieprawidłowy lub wygasł." },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    // Any other outstanding reset links for this user become stale once the
    // password actually changes — leaving them valid would let an old,
    // possibly-leaked link still work after a successful reset.
    prisma.passwordResetToken.deleteMany({
      where: { userId: resetToken.userId, id: { not: resetToken.id } },
    }),
  ]);

  logInfo("password_reset_completed", { userId: resetToken.userId });
  return NextResponse.json({ message: "Hasło zostało zmienione." });
}
