// NEXT_PUBLIC_APP_VERSION/COMMIT are set at `next build` time (see the
// "build" script in package.json) and inlined into the bundle by Next.js —
// the production server never needs these in its own .env.
export function AppFooter() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
  const commit = process.env.NEXT_PUBLIC_APP_COMMIT ?? "dev";

  return (
    <footer className="border-t border-gray-200 px-4 py-3 text-center text-xs text-gray-400">
      wersja {version} · {commit}
    </footer>
  );
}
