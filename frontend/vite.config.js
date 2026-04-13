import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("react") || id.includes("scheduler")) {
            return "vendor-react";
          }
          if (id.includes("@radix-ui")) {
            return "vendor-radix";
          }
          if (id.includes("@dnd-kit")) {
            return "vendor-dnd";
          }
          if (id.includes("wavesurfer.js")) {
            return "vendor-wavesurfer";
          }
          if (id.includes("framer-motion")) {
            return "vendor-motion";
          }
          return "vendor-misc";
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
