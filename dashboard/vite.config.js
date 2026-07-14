import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devApiTarget = "http://127.0.0.1:8787";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/config": {
        target: devApiTarget,
        changeOrigin: true,
      },
      "/notify": {
        target: devApiTarget,
        changeOrigin: true,
      },
      "/profiles": {
        target: devApiTarget,
        changeOrigin: true,
      },
      "/status": {
        target: devApiTarget,
        changeOrigin: true,
      },
      "/paceman": {
        target: devApiTarget,
        changeOrigin: true,
      },
      "/install/": {
        target: devApiTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
