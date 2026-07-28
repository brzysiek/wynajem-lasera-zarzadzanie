// Must be kept in sync with next.config.ts's basePath — both read the same
// env var so a single build produces a consistent app. Next.js bakes
// basePath into the build at compile time, so this can't be a per-server
// runtime setting: serving this app under a different URL prefix on another
// server requires a separate build with NEXT_PUBLIC_BASE_PATH set
// differently (see .github/workflows/deploy.yml's build-server-2 job), not
// just a different .env on that server.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/wynajem";
