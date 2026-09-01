import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { createResetToken, buildResetUrl, INVITE_TOKEN_TTL_MS } from "@/lib/password-reset";
import { sendUserInviteEmail } from "@/lib/email";
import { logInfo, logWarn, logError } from "@/lib/logger";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      canActAsDriver: true,
      grammaticalGender: true,
      invitedAt: true,
      activatedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body?.role === "ADMIN" ? "ADMIN" : body?.role === "KIEROWCA" ? "KIEROWCA" : "STAFF";
  const canActAsDriver = role !== "KIEROWCA" && body?.canActAsDriver === true;
  const grammaticalGender =
    body?.grammaticalGender === "M" || body?.grammaticalGender === "F" ? body.grammaticalGender : null;

  if (!name || !EMAIL_PATTERN.test(email)) {
    logWarn("user_invite_rejected", { userId: session.user.id, reason: "invalid_input" });
    return NextResponse.json({ message: "Podaj imię i poprawny adres e-mail." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    logWarn("user_invite_rejected", { userId: session.user.id, reason: "email_exists", email });
    return NextResponse.json({ message: "Użytkownik z takim adresem e-mail już istnieje." }, { status: 409 });
  }

  // Unusable until the invite is accepted — nobody can log in with this
  // hash since the raw value is discarded immediately.
  const placeholderHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);

  const user = await prisma.user.create({
    data: { name, email, role, canActAsDriver, grammaticalGender, passwordHash: placeholderHash, invitedAt: new Date() },
  });

  logInfo("user_invited", { userId: session.user.id, invitedUserId: user.id, email });

  let emailSent = true;
  try {
    const token = await createResetToken(user.id, INVITE_TOKEN_TTL_MS);
    await sendUserInviteEmail(user.email, user.name, buildResetUrl(token));
  } catch (err) {
    emailSent = false;
    logError("user_invite_send_failed", err, { invitedUserId: user.id });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      canActAsDriver: user.canActAsDriver,
      grammaticalGender: user.grammaticalGender,
      invitedAt: user.invitedAt,
      activatedAt: user.activatedAt,
      createdAt: user.createdAt,
    },
    emailSent,
  });
}
