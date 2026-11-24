/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Amplo tokens (src/design-system/tokens/tokens.css), theme-aware via CSS variables.
      colors: {
        page: 'var(--bg)',
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)', 3: 'var(--surface-3)' },
        line: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
        ink: { DEFAULT: 'var(--text)', 2: 'var(--text-2)', 3: 'var(--text-3)' },
        accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)', soft: 'var(--accent-soft)', ink: 'var(--accent-ink)' },
        ok: { DEFAULT: 'var(--green)', soft: 'var(--green-soft)' },
        warn: { DEFAULT: 'var(--amber)', soft: 'var(--amber-soft)' },
        danger: { DEFAULT: 'var(--red)', soft: 'var(--red-soft)' },
      },
      fontFamily: {
        sans: ['Geist Variable', 'Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono Variable', 'Geist Mono', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        card: 'var(--r-card)',
        ctl: 'var(--r-ctl)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
      },
    },
  },
  plugins: [],
};
