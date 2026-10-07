import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The browser decoder and optional Python bridge share this schema.
const schemaPath = fileURLToPath(new URL("./mpc_schema.json", import.meta.url));
const dashRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@mpc-schema": schemaPath,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [dashRoot],
    },
  },
});
