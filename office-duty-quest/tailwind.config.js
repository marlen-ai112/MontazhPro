/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#07090d', 900: '#0b0e14', 800: '#11151d', 700: '#171c27', 600: '#212837', 500: '#2d3547' },
        volt: { DEFAULT: '#4f8cff', 400: '#6ea0ff', 500: '#4f8cff', 600: '#3a74ec' },
        royal: { DEFAULT: '#8b5cf6', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7440e8' },
        gold: { DEFAULT: '#f5c451', 400: '#f8d479', 500: '#f5c451', 600: '#d9a52b' },
        ok: '#34d399',
        warn: '#fbbf24',
        bad: '#f87171',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Exo 2 Variable"', '"Exo 2"', '"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 32px -12px rgba(0,0,0,0.7)',
        glow: '0 0 0 1px rgba(79,140,255,0.35), 0 0 32px -6px rgba(79,140,255,0.45)',
        gold: '0 0 0 1px rgba(245,196,81,0.4), 0 0 28px -6px rgba(245,196,81,0.4)',
      },
      keyframes: {
        floatUp: { '0%': { opacity: 0, transform: 'translateY(8px) scale(.8)' }, '15%': { opacity: 1 }, '100%': { opacity: 0, transform: 'translateY(-70px) scale(1.15)' } },
        pop: { '0%': { transform: 'scale(.85)', opacity: 0 }, '100%': { transform: 'scale(1)', opacity: 1 } },
        slideUp: { '0%': { transform: 'translateY(14px)', opacity: 0 }, '100%': { transform: 'translateY(0)', opacity: 1 } },
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        pulseGlow: { '0%,100%': { boxShadow: '0 0 0 1px rgba(79,140,255,.35), 0 0 24px -8px rgba(79,140,255,.4)' }, '50%': { boxShadow: '0 0 0 1px rgba(139,92,246,.5), 0 0 36px -4px rgba(139,92,246,.55)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        confetti: { '0%': { transform: 'translate3d(0,0,0) rotate(0)', opacity: 1 }, '100%': { transform: 'translate3d(var(--dx),var(--dy),0) rotate(var(--rot))', opacity: 0 } },
        load: { '0%': { width: '0%' }, '100%': { width: '100%' } },
      },
      animation: {
        floatUp: 'floatUp 1.3s ease-out forwards',
        pop: 'pop .28s cubic-bezier(.2,.9,.3,1.2) both',
        slideUp: 'slideUp .35s ease-out both',
        fadeIn: 'fadeIn .25s ease-out both',
        pulseGlow: 'pulseGlow 2.6s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        confetti: 'confetti var(--dur) cubic-bezier(.15,.7,.3,1) forwards',
      },
    },
  },
  plugins: [],
};
