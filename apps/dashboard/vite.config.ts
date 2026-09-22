import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: {
      "/control": {
        target: process.env.VITE_CONTROL_TARGET ?? "http://localhost:8081",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/control/, ""),
      },
      "/gateway": {
        target: process.env.VITE_GATEWAY_TARGET ?? "http://localhost:8080",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/gateway/, ""),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          primitives: ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-switch"],
        },
      },
    },
  },
});
