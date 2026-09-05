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
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Dev proxy and direct production requests share the local companion API address.
  server: {
    proxy: {
      "/api": {
        target: `http://${services.neteaseApi.host}:${services.neteaseApi.port}`,
        changeOrigin: true,
      },
    },
  },
});
