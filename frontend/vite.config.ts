import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Запросы фронта идут на /api/… — в разработке Vite проксирует их на бэкенд.
// По умолчанию — Raspberry Pi бэкендера в Tailscale (нужно быть подключённым к сети Tailscale).
// Другой адрес задаётся переменной VITE_API_TARGET в файле .env.local (например, http://localhost:8080).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_API_TARGET || 'http://100.116.127.113:8080'
  // ИИ-контур (генерация текста сценариев, распознавание и синтез речи)
  const aiTarget = env.VITE_AI_TARGET || 'http://localhost:8090'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ai': { target: aiTarget, changeOrigin: true, rewrite: (p) => p.replace(/^\/ai/, '') },
      },
    },
  }
})
