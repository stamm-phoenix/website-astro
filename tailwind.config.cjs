// tailwind.config.cjs
module.exports = {
    content: ['./src/**/*.{astro,html,js,ts,jsx,tsx}', './public/admin/**/*.html'],
    theme: {
      extend: {
        fontFamily: {
          heading: ['Arvo', 'Rockwell', 'Merriweather', 'serif'],
          body: ['Calibri', 'Segoe UI', 'system-ui', '-apple-system', 'Roboto', 'Helvetica', 'Arial'],
          sans: ['Calibri', 'Segoe UI', 'system-ui', '-apple-system', 'Roboto', 'Helvetica', 'Arial'],
          serif: ['Arvo', 'Rockwell', 'Merriweather', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
        },
        colors: {
          dpsg: {
            DEFAULT: '#003056',
            blue: '#003056',
            red: '#810A1A',
            beige1: '#ECDFCB',
            beige2: '#C7BDAD',
            magenta: '#E6007E',
            yellow: '#FFED00',
            cyan: '#009FE3',
          },
          brand: {
            50: '#e7edf4',
            100: '#d4deea',
            200: '#afc3d7',
            300: '#7ea1be',
            400: '#4e7aa1',
            500: '#2d5a80',
            600: '#1b466a',
            700: '#12395a',
            800: '#0a2d48',
            900: '#003056',
          },
          accent: {
            500: '#810A1A',
          },
          neutral: {
            50: '#f9f6f0',
            100: '#f2eadc',
            200: '#e4d7be',
            700: '#3c3a36',
            900: '#141312',
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
