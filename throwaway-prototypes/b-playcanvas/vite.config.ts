import { defineConfig } from "vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 3000,
  },
  server: {
    host: true,
    port: 5175,
  },
});
