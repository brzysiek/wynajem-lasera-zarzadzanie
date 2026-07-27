import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/integrations/szybkisms";
import { normalizePolishPhone } from "@/lib/reminders";
import { logInfo, logError } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const rawPhone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const rentalId = typeof body?.rentalId === "string" && body.rentalId ? body.rentalId : null;

  if (!message) {
    return NextResponse.json({ message: "Treść wiadomości nie może być pusta." }, { status: 400 });
  }

  const phone = normalizePolishPhone(rawPhone);
  if (!phone) {
    // Every real send attempt is recorded — including ones that fail because
    // there's no usable phone number, per the requirement that a SMS cannot
    // go out without one but the attempt must still show up in history.
    await prisma.message.create({
      data: {
        rentalId,
        userId: session.user.id,
        channel: "SMS",
        recipient: rawPhone || "(brak numeru)",
        body: message,
        status: "FAILED",
        errorMessage: "Brak poprawnego numeru telefonu.",
      },
    });
    return NextResponse.json({ message: "Podaj poprawny polski numer telefonu." }, { status: 400 });
  }

  const result = await sendSms(phone, message);

  await prisma.message.create({
    data: {
      rentalId,
      userId: session.user.id,
      channel: "SMS",
      recipient: phone,
      body: message,
      status: result.ok ? "SENT" : "FAILED",
      providerMessageId: result.providerMessageId,
      errorMessage: result.ok ? null : result.message,
    },
  });

  if (!result.ok) {
    logError("sms_manual_send_failed", new Error(result.message), { userId: session.user.id, phone });
    return NextResponse.json({ message: result.message }, { status: 502 });
  }

  logInfo("sms_manual_sent", { userId: session.user.id, phone });
  return NextResponse.json({ ok: true });
}
