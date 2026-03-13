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