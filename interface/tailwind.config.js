/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0a',
        foreground: '#fafafa',
        card: '#141414',
        'card-foreground': '#fafafa',
        border: '#262626',
        muted: '#171717',
        'muted-foreground': '#a3a3a3',
        accent: '#262626',
        'accent-foreground': '#fafafa',
        destructive: '#ef4444',
        success: '#22c55e',
        warning: '#eab308',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
