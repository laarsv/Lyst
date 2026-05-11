/** @type {import('tailwindcss').Config} */
const themed = (cssVar) => `rgb(var(${cssVar}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Theme switching is driven by `<html data-theme="dark">` (set from JS),
  // so we don't use Tailwind's own `dark:` selector.
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: themed('--color-brand'),
          50:  themed('--color-brand-50'),
          100: themed('--color-brand-100'),
          500: themed('--color-brand'),
          600: '#00b386',
          700: themed('--color-brand-700'),
        },
        page: themed('--color-page'),
        surface: themed('--color-surface'),
        ink: themed('--color-ink'),
        muted: themed('--color-muted'),
        line: themed('--color-line'),
        danger: {
          DEFAULT: themed('--color-danger'),
          50: themed('--color-danger-50'),
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
