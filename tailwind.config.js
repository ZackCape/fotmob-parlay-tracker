/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          900: '#064e3b',
        },
        navy: {
          800: '#0f172a',
          900: '#0b0f19',
          950: '#070a10',
        },
        fotmob: {
          bg: '#0d0e11',
          card: '#16181d',
          surface: '#1c1f26',
          border: '#252932',
          green: '#00d66c',
          greenDark: '#00b85c',
          muted: '#8c92a4',
          subtle: '#2a2f3a',
        }
      }
    },
  },
  plugins: [],
}
