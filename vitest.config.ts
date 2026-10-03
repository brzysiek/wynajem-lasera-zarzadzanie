import { defineConfig } from "vitest/config";

// Testy dotyczą wyłącznie czystych funkcji w src/lib/pricing/ — środowisko
// node, bez jsdom, bez aliasu "@/" (moduły pricing importują się względnie).
// Alias "@/" — potrzebny testom tras API (np. webhook formularzy WWW), które
// mockują prisma i moduły zapisu.
export default defineConfig({
  resolve: { alias: { "@/": new URL("./src/", import.meta.url).pathname } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
