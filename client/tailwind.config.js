/** Tailwind coexists with Bootstrap 5, so its preflight reset stays off. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#6027FF',
          dark: '#130C2D',
          soft: '#EEF0F4',
          600: '#6027FF',
          700: '#4C1FE0',
          800: '#3A17B0',
        },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: { card: '0 2px 12px rgba(19, 12, 45, 0.06)' },
    },
  },
  plugins: [],
};
