import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // 🌟 1. นำเข้า path

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // 🌟 2. กำหนด alias
    },
  },
})