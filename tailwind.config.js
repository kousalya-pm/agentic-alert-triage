/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'soc-dark':   '#0a0f1e',
        'soc-panel':  '#0f1629',
        'soc-card':   '#131d35',
        'soc-border': '#1e2d4a',
        'soc-accent': '#00d4ff',
        'soc-muted':  '#7a9cc0',
      }
    },
  },
  plugins: [],
}
