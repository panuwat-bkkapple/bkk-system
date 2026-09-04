// `vitest/config`, not `vite` — it is the same defineConfig with the `test`
// key added to the type. Imported from 'vite' the config below fails
// `tsc -b` with "'test' does not exist in type 'UserConfigExport'", which
// `tsc --noEmit` does NOT catch: the root tsconfig does not include this
// file, the project build does.
import { defineConfig } from 'vitest/config'
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
    // `src/` คือของแอปแอดมิน · `employee-app/src/` คือแอปพนักงาน (PWA แยก)
    //
    // **เทสข้ามเข้ามาได้ โค้ดข้ามออกไปไม่ได้** — แอปพนักงานยังห้าม import จาก
    // `src/` เหมือนเดิม (กฎเดียวกับ dealer-portal) แต่ตรรกะที่ตัดสินว่า "ใช้
    // แอปได้ไหม" (ประตู GPS) ต้องมีด่านจริง ถ้าปล่อยให้อยู่นอกสายตา vitest
    // มันจะเป็นโค้ดที่ไม่มีใครทดสอบ ในแอปที่ทั้งแอปขึ้นอยู่กับมัน
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'employee-app/src/**/*.{test,spec}.{ts,tsx}'],
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