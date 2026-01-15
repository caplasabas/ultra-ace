/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#0f172a', // slate-900
        surface: '#020617', // slate-950
      },
    },
  },
  plugins: [],
}
