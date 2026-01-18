/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "index.html",
    "App.tsx",
    "index.tsx",
    "pages/**/*.{js,ts,jsx,tsx}",
    "components/**/*.{js,ts,jsx,tsx}",
    "src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    'bg-blue-600',
    'text-white',
    'p-4',
    'flex',
    'grid',
    'min-h-screen',
    'bg-gray-50'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
