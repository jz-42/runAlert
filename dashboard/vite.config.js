import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/config": {
        target: "https://minecraft-speedrun-notifier.onrender.com",
        changeOrigin: true,
      },
      "/notify": {
        target: "https://minecraft-speedrun-notifier.onrender.com",
        changeOrigin: true,
      },
      "/profiles": {
        target: "https://minecraft-speedrun-notifier.onrender.com",
        changeOrigin: true,
      },
      "/status": {
        target: "https://minecraft-speedrun-notifier.onrender.com",
        changeOrigin: true,
      },
      "/paceman": {
        target: "https://minecraft-speedrun-notifier.onrender.com",
        changeOrigin: true,
      },
      "/install": {
        target: "https://minecraft-speedrun-notifier.onrender.com",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
