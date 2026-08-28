import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from 'path'

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  // 项目入口在 src/index.html(旧 vite.renderer.config.mts 的 root 沿用)
  root: 'src',
  base: "./",
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  server: {
    // 与 tauri.conf.json devUrl、chat_skin_inject.js 的 origin 白名单保持一致
    port: 5188,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // tauri.conf.json frontendDist = ../out/renderer
    outDir: resolve('out/renderer'),
    emptyOutDir: true,
    target: 'es2021'
  },
}));
