import { defineConfig } from "vitest/config";

// Testy dotyczą wyłącznie czystych funkcji w src/lib/pricing/ — środowisko
// node, bez jsdom, bez aliasu "@/" (moduły pricing importują się względnie).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
