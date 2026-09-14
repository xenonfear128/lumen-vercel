import services from "./config/local-services.json";
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'vercel' ? [] : [viteSingleFile()])],
  build: { outDir: mode === 'vercel' ? 'dist-vercel' : 'dist' },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Dev proxy and direct production requests share the local companion API address.
  server: {
    watch: { ignored: ["**/.tools/**", "**/android/**", "**/release/**", "**/test-results/**", "**/workspaces/**"] },
    proxy: {
      "/api": {
        target: `http://${services.neteaseApi.host}:${services.neteaseApi.port}`,
        changeOrigin: true,
      },
    },
  },
}));
