import type { Config } from 'tailwindcss';

/**
 * Cyberpunk / Synthwave palette.
 *
 * We override Tailwind's stock zinc/indigo/rose/sky scales rather than
 * adding new tokens, so every existing `bg-zinc-900`, `text-indigo-400`,
 * `border-rose-500/30` etc. throughout the app immediately picks up the
 * new colors without touching any component class names.
 *
 *   zinc    → deep navy backgrounds (#020B24 deepest → #0A1435 cards)
 *   indigo  → electric cyan #00A3FF (primary accent / active states)
 *   rose    → neon magenta #D800E6 (favorites)
 *   sky     → electric purple #9D00FF (interested)
 *   amber   → kept gold for "current season" and "aired" markers
 *   emerald → kept green for success ("Added")
 *   red     → kept red for danger (delete, errors)
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        zinc: {
          50: '#FFFFFF',
          100: '#FFFFFF',
          200: '#E2E8F0',
          300: '#A3B0CC',
          400: '#6B7AA0',
          500: '#4A5680',
          600: '#2F3866',
          700: '#1C2553',
          800: '#0A1435',
          900: '#061030',
          950: '#020B24',
        },
        indigo: {
          50:  '#E6F6FF',
          100: '#CCEDFF',
          200: '#99DBFF',
          300: '#66C9FF',
          400: '#33B6FF',
          500: '#00A3FF',
          600: '#0086D1',
          700: '#0066A3',
          800: '#004D7A',
          900: '#003352',
          950: '#001F33',
        },
        rose: {
          50:  '#FFE5FC',
          100: '#FFCCF9',
          200: '#FF99F3',
          300: '#FF66ED',
          400: '#F033E5',
          500: '#D800E6',
          600: '#AE00B8',
          700: '#82008A',
          800: '#570058',
          900: '#2B0033',
          950: '#15001A',
        },
        sky: {
          50:  '#F3E5FF',
          100: '#E6CCFF',
          200: '#CC99FF',
          300: '#B266FF',
          400: '#A833FF',
          500: '#9D00FF',
          600: '#7E00CC',
          700: '#5E0099',
          800: '#3F0066',
          900: '#1F0033',
          950: '#10001A',
        },
        cyber: {
          bg: '#020B24',
          surface: '#0A1435',
          surfaceAlt: '#061030',
          cyan: '#00A3FF',
          magenta: '#D800E6',
          purple: '#9D00FF',
          text: '#E2E8F0',
          textBright: '#FFFFFF',
        },
      },
      boxShadow: {
        'neon-cyan': '0 0 24px -4px #00A3FF, 0 0 8px -2px #00A3FF',
        'neon-magenta': '0 0 24px -4px #D800E6, 0 0 8px -2px #D800E6',
        'neon-purple': '0 0 24px -4px #9D00FF, 0 0 8px -2px #9D00FF',
      },
    },
  },
  plugins: [],
};

export default config;
