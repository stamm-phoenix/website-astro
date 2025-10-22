// tailwind.config.cjs
module.exports = {
    content: ['./src/**/*.{astro,html,js,ts,jsx,tsx}', './public/admin/**/*.html'],
    theme: {
      extend: {
        fontFamily: {
          heading: ['Arvo', 'Georgia', 'serif'],
          body: ['Calibri', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial'],
          sans: ['Calibri', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial'],
          serif: ['Arvo', 'Georgia', 'serif'],
        },
        colors: {
          dpsg: { DEFAULT: '#003056', blue: '#003056', red: '#810A1A' },
          brand: {
            50: '#eef6ff',
            100: '#dbeefe',
            200: '#bfdffd',
            300: '#93c8fb',
            400: '#60a7f7',
            500: '#2f80ed', // primary
            600: '#2566c2',
            700: '#1f55a1',
            800: '#1b4886',
            900: '#173b6e',
          },
          accent: {
            500: '#f39c12',
          },
          neutral: {
            50: '#f8fafc',
            100: '#f1f5f9',
            200: '#e2e8f0',
            700: '#334155',
            900: '#0f172a',
          }
        },
        borderRadius: {
          'sm': '0.375rem',
          'md': '0.5rem',
          'lg': '0.75rem',
        },
        boxShadow: {
          'soft': '0 1px 2px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.06)',
          'lift': '0 6px 20px rgba(0,0,0,.08)',
        }
      },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
  };
