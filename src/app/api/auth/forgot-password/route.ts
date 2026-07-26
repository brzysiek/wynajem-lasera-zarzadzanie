import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createResetToken, buildResetUrl } from "@/lib/password-reset";
import { sendPasswordResetEmail } from "@/lib/email";

// Always returns the same generic response whether or not the e-mail
// exists, so this endpoint can't be used to enumerate registered accounts.
const GENERIC_RESPONSE = {
  message: "Jeśli podany adres istnieje w naszym systemie, wysłaliśmy na niego link do resetu hasła.",
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email) {
    return NextResponse.json({ message: "Podaj adres e-mail." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const rawToken = await createResetToken(user.id);
    try {
      await sendPasswordResetEmail(user.email, buildResetUrl(rawToken));
    } catch (err) {
      console.error("Failed to send password reset email:", err);
    }
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
