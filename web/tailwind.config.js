/** @type {import('tailwindcss').Config} */
// "Twilight Campus": midnight background, frosted-glass surfaces, lavender/indigo light.
// One palette, one radius scale, one shadow scale, three motion speeds — used on every screen.
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        midnight: {
          DEFAULT: '#080B1A', // primary background
          900: '#080B1A',
          800: '#0E1328', // secondary background
          700: '#151B36',
        },
        indigo: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1', // EventEase Indigo
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        lavender: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#A78BFA', // Lavender
          500: '#8b5cf6',
          600: '#7c3aed',
        },
        electric: '#60A5FA', // Electric Blue
        cyan: { 300: '#67E8F9', 400: '#22d3ee' }, // Soft Cyan
        teal: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        // Small 10 · Medium 16 · Large 24 · Pill 999
        sm: '10px',
        md: '12px', // buttons
        lg: '12px',
        xl: '16px', // cards
        '2xl': '20px',
        '3xl': '24px', // hero surfaces
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,.35)',
        DEFAULT: '0 4px 14px rgba(0,0,0,.35)',
        md: '0 10px 30px rgba(0,0,0,.40)',
        lg: '0 18px 50px rgba(0,0,0,.45)',
        xl: '0 24px 70px rgba(0,0,0,.5)',
        glow: '0 12px 40px rgba(0,0,0,.45), 0 0 0 1px rgba(167,139,250,.35), 0 0 28px rgba(99,102,241,.25)',
      },
      ringOffsetColor: {
        DEFAULT: '#080B1A',
      },
      transitionDuration: {
        micro: '150ms',
        move: '300ms',
        celebrate: '800ms',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'rise-in': {
          '0%': { opacity: '0', transform: 'translateY(40px) scale(.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(.6)' },
          '70%': { opacity: '1', transform: 'scale(1.08)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        float: 'float 7s ease-in-out infinite',
        'float-slow': 'float 9s ease-in-out infinite',
        'rise-in': 'rise-in 800ms cubic-bezier(.2,.8,.2,1) both',
        'pop-in': 'pop-in 600ms cubic-bezier(.2,.8,.2,1) both',
        'slide-down': 'slide-down 250ms ease-out both',
        'slide-in-right': 'slide-in-right 300ms cubic-bezier(.2,.8,.2,1) both',
      },
    },
  },
  plugins: [],
}
