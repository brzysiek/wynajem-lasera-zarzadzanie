import { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { BASE_PATH } from "@/lib/base-path";

// Next.js strips the basePath from the URL before this route handler runs
// (unlike middleware, where pathname keeps it), so NextAuth's own basePath
// (set in src/auth.ts) can't match incoming requests and can't build
// correct outgoing URLs either. Add the prefix back before handing the
// request to NextAuth so both sides agree.

function withBasePath(req: NextRequest): NextRequest {
  const { href, pathname } = req.nextUrl;
  if (pathname.startsWith(BASE_PATH)) return req;
  return new NextRequest(href.replace(pathname, `${BASE_PATH}${pathname}`), req);
}

export async function GET(req: NextRequest) {
  return handlers.GET(withBasePath(req));
}

export async function POST(req: NextRequest) {
  return handlers.POST(withBasePath(req));
}
