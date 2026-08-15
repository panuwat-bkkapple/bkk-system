import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // 🌟 1. นำเข้า path

export default defineConfig({
  plugins: [react()],
  // Vitest owns src/ ONLY.
  //
  // functions/test/*.test.mjs are standalone harnesses run by plain `node` —
  // they are the offline suites for the Cloud Functions, which cannot import
  // the TS app and end in process.exit(). Left to the default glob, vitest
  // collects them, sees the exit call and reports "process.exit unexpectedly
  // called with 0" — six red files for six suites that all passed. The CI job
  // that actually runs them is the functions job.
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
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