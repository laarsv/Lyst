/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#00c896',
          50: '#e6faf5',
          100: '#ccf5ea',
          500: '#00c896',
          600: '#00b386',
          700: '#009070',
        },
        // Semantic surface/text tokens — used directly via bg-page, text-ink etc.
        page: '#f5f5f0',
        surface: '#ffffff',
        ink: '#1a1a1a',
        muted: '#888884',
        line: '#e5e5e3',
        danger: {
          DEFAULT: '#e05252',
          50: '#fdf0f0',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      letterSpacing: {
        tight: '-0.01em',
      },
      boxShadow: {
        flat: '0 1px 3px rgba(0,0,0,0.06)',
      },
      borderRadius: {
        card: '10px',
        ctl: '8px',
        chip: '6px',
      },
    },
  },
  plugins: [],
};
