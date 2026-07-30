/**
 * vite.renderer.config: Tauri 版渲染层独立构建(脱离 electron-vite)。
 * 与 electron.vite.config.ts 的 renderer 段保持同源:同 root、同 alias、同插件。
 * 输出到 out/renderer,与 electron-vite 产物同位置,两者互不影响(不同时构建即可)。
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  root: 'src/renderer',
  base: './',
  resolve: {
    alias: {
      '@': resolve('src/renderer/src')
    }
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5188,
    strictPort: true
  },
  build: {
    outDir: resolve('out/renderer'),
    emptyOutDir: true,
    target: 'es2021'
  },
  // Tauri 用,clearScreen 交给 cargo 输出
  clearScreen: false
})
