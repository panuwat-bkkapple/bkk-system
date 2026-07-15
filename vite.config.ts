import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // 🌟 1. นำเข้า path

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      // Two entry pages, one build: index.html = admin app, chat.html = the
      // standalone chat console (served from its own Hosting site/target).
      input: {
        main: path.resolve(__dirname, 'index.html'),
        chat: path.resolve(__dirname, 'chat.html'),
      },
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/database', 'firebase/storage'],
          ui: ['lucide-react', 'recharts'],
        },
      },
    },
  },
})