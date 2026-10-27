import { prisma } from "@/lib/prisma";
import type { ChatChannelKey } from "./meta-rules";

// Wątki czatu (Messenger / Instagram) do zakładki „Czat” w karcie sygnału i klienta (wniosek 42).

export type ChatMessageDto = { id: string; direction: "IN" | "OUT"; text: string | null; attachments: { type: string; url: string | null }[]; at: string };
export type ChatThreadDto = {
  id: string;
  channel: ChatChannelKey;
  displayName: string | null;
  // Klientka czeka na odpowiedź od tego momentu (ostatnia jej wiadomość po naszej).
  waitingSince: string | null;
  messages: ChatMessageDto[];
};

const asAttachments = (v: unknown): ChatMessageDto["attachments"] =>
  Array.isArray(v) ? v.filter((x): x is { type: string; url: string | null } => !!x && typeof x === "object" && typeof (x as { type?: unknown }).type === "string") : [];

export async function loadChatThreads(where: { leadId?: string; clientId?: string | null }): Promise<ChatThreadDto[]> {
  const or = [...(where.leadId ? [{ leadId: where.leadId }] : []), ...(where.clientId ? [{ clientId: where.clientId }] : [])];
  if (!or.length) return [];
  const threads = await prisma.chatThread.findMany({
    where: { OR: or },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, channel: true, displayName: true, lastInboundAt: true, lastOutboundAt: true,
      messages: { orderBy: { sentAt: "desc" }, take: 200, select: { id: true, direction: true, text: true, attachments: true, sentAt: true } },
    },
  });
  return threads.map((t) => ({
    id: t.id,
    channel: t.channel,
    displayName: t.displayName,
    waitingSince: t.lastInboundAt && (!t.lastOutboundAt || t.lastInboundAt > t.lastOutboundAt) ? t.lastInboundAt.toISOString() : null,
    messages: [...t.messages].reverse().map((m) => ({ id: m.id, direction: m.direction, text: m.text, attachments: asAttachments(m.attachments), at: m.sentAt.toISOString() })),
  }));
}
