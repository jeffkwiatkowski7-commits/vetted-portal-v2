/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        vetted: {
          primary: '#1A1A1A',
          accent: '#C4A962',
          'accent-dark': '#B09952',
          background: '#FFFFFF',
          surface: '#F9FAFB',
          border: '#E5E7EB',
          'text-primary': '#1A1A1A',
          'text-secondary': '#6B7280',
          'text-muted': '#9CA3AF',
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
          info: '#3B82F6',
        },
      },
      fontFamily: {
        serif: ['Playfair Display', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        card: '12px',
      },
      width: {
        sidebar: '280px',
        'sidebar-collapsed': '64px',
      },
      animation: {
        'pulse-gold': 'pulseGold 1.5s ease-in-out infinite',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease',
        'scale-in': 'scaleIn 0.2s ease',
      },
      keyframes: {
        pulseGold: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(196, 169, 98, 0.4)' },
          '50%': { boxShadow: '0 0 0 8px rgba(196, 169, 98, 0)' },
        },
        slideInRight: {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
