import { NextRequest } from "next/server";
import { json, withAgent } from "@/lib/agent-api/handler";
import { listSuspectedBlobs } from "@/lib/clients/blob-load";

// API agenta: podejrzane zlepki klientów, od najbardziej podejrzanych.
export async function GET(req: NextRequest) {
  return withAgent(req, async () => json({ blobs: await listSuspectedBlobs() }));
}
