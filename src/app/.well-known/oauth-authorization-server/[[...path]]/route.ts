import { NextResponse } from "next/server";
import { authorizationServerMetadata } from "@/lib/oauth/config";

// RFC 8414 — metadane serwera autoryzacji panelu (konektor MCP).
export function GET() {
  return NextResponse.json(authorizationServerMetadata(), { headers: { "Cache-Control": "public, max-age=300" } });
}
