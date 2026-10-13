import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // `import "server-only"` throws outside a react-server bundle; tests import server modules directly
      "server-only": resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});
