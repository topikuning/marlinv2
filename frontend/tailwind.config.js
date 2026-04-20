/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Lexend", "Inter", "ui-sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        brand: {
          50: "#eef5ff",
          100: "#d9e8ff",
          200: "#bcd7ff",
          300: "#8ebcff",
          400: "#5997ff",
          500: "#3672fb",
          600: "#1e50ef",
          700: "#173dd8",
          800: "#1834af",
          900: "#1a3389",
        },
        ink: {
          50: "#f8f9fa",
          100: "#eef0f3",
          200: "#d9dde3",
          300: "#b4bac4",
          400: "#838b99",
          500: "#5b6573",
          600: "#424b58",
          700: "#323a45",
          800: "#1f2630",
          900: "#0d1117",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15,23,42,.04), 0 1px 3px rgba(15,23,42,.06)",
        hard: "0 10px 25px -12px rgba(15,23,42,.25)",
      },
    },
  },
  plugins: [],
};
