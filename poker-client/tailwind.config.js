/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "poker-green": "#0B7C3E",
        "poker-felt": "#1E5C2E",
        "card-red": "#DC143C",
      },
    },
  },
  plugins: [],
};
