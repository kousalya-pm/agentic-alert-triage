/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'soc-dark': '#0d1117',
        'soc-panel': '#161b22',
        'soc-border': '#30363d',
        'soc-accent': '#1f6feb',
      }
    },
  },
  plugins: [],
}
