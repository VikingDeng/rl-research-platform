import path from 'path';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    path.join(process.cwd(), "index.html"),
    path.join(process.cwd(), "App.tsx"),
    path.join(process.cwd(), "index.tsx"),
    path.join(process.cwd(), "pages/**/*.{js,ts,jsx,tsx}"),
    path.join(process.cwd(), "components/**/*.{js,ts,jsx,tsx}"),
    path.join(process.cwd(), "src/**/*.{js,ts,jsx,tsx}"),
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