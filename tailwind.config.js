/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
      "./src/**/*.{js,jsx,ts,tsx}",
    ],
    theme: {
      extend: {
        fontFamily: {
          sans: ['Inter', 'sans-serif'], // Example font
        },
      },
    },
    plugins: [
      require('@tailwindcss/typography'),
    ],
  }
  