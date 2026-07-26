import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { updateCalendarEvent, deleteCalendarEvent } from "@/lib/integrations/google-calendar";
import { logInfo } from "@/lib/logger";

// Device/calendar are not editable here — moving a rental to a different
// device's calendar would require Google's events.move API, which this
// stage doesn't implement.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const rental = await prisma.rental.findUnique({ where: { id } });
  if (!rental) {
    return NextResponse.json({ message: "Nie znaleziono rezerwacji." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : rental.title;
  const description = typeof body?.description === "string" ? body.description.trim() : rental.description ?? "";
  const allDay = typeof body?.allDay === "boolean" ? body.allDay : rental.allDay;
  const startsAt = typeof body?.startsAt === "string" ? new Date(body.startsAt) : rental.startsAt;
  const endsAt = typeof body?.endsAt === "string" ? new Date(body.endsAt) : rental.endsAt;

  if (!title || isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    return NextResponse.json({ message: "Uzupełnij tytuł i poprawny termin." }, { status: 400 });
  }
  if (endsAt <= startsAt) {
    return NextResponse.json({ message: "Termin zakończenia musi być późniejszy niż rozpoczęcia." }, { status: 400 });
  }

  try {
    await updateCalendarEvent(rental.googleCalendarId, rental.googleEventId, {
      title,
      description: description || null,
      startsAt,
      endsAt,
      allDay,
    });

    const updated = await prisma.rental.update({
      where: { id },
      data: { title, description: description || null, startsAt, endsAt, allDay, lastSyncedAt: new Date() },
      include: { device: true },
    });

    logInfo("rental_updated", { userId: session.user.id, rentalId: id });

    return NextResponse.json({ rental: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const rental = await prisma.rental.findUnique({ where: { id } });
  if (!rental) {
    return NextResponse.json({ message: "Nie znaleziono rezerwacji." }, { status: 404 });
  }

  try {
    await deleteCalendarEvent(rental.googleCalendarId, rental.googleEventId);
    // Hard-delete: no messages/reminders reference this rental yet, so
    // there's no history to preserve (unlike the pull-sync soft-delete).
    await prisma.rental.delete({ where: { id } });

    logInfo("rental_deleted", { userId: session.user.id, rentalId: id });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 502 });
  }
}
