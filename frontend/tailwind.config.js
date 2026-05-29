/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#F97316',
        bgbase: '#F4F6F9',
      },
    },
  },
  plugins: [],
};
