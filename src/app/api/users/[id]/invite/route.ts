import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { createResetToken, buildResetUrl, INVITE_TOKEN_TTL_MS } from "@/lib/password-reset";
import { sendUserInviteEmail } from "@/lib/email";
import { logInfo, logWarn, logError } from "@/lib/logger";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ message: "Nie znaleziono użytkownika." }, { status: 404 });
  }
  if (target.activatedAt) {
    logWarn("user_invite_resend_rejected", { userId: session.user.id, targetUserId: target.id });
    return NextResponse.json({ message: "Użytkownik już aktywował konto." }, { status: 400 });
  }

  try {
    const token = await createResetToken(target.id, INVITE_TOKEN_TTL_MS);
    await sendUserInviteEmail(target.email, target.name, buildResetUrl(token));
  } catch (err) {
    logError("user_invite_resend_failed", err, { targetUserId: target.id });
    return NextResponse.json({ message: "Nie udało się wysłać e-maila z zaproszeniem." }, { status: 502 });
  }

  logInfo("user_invite_resent", { userId: session.user.id, targetUserId: target.id });
  return NextResponse.json({ ok: true });
}
