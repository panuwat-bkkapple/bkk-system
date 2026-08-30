/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Ink for receded (terminal/soft-closed) rows in job lists — tokens
        // declared in design.md (bkk-frontend-next, shared source of truth).
        // Anchored to the slate scale this admin already uses everywhere.
        // ink-receded holds >= 4.5:1 on white, slate-50 and slate-100;
        // ink-receded-muted holds >= 4.5:1 on white and slate-50 ONLY — on a
        // slate-100 chip it drops to 4.34:1, use ink-receded there instead.
        'ink-receded': '#475569', // slate-600
        'ink-receded-muted': '#64748b', // slate-500
      },
    },
  },
  plugins: [],
}