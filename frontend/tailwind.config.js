/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Plus Jakarta Sans = primary body (per Marlin Redesign handoff)
        sans: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Lexend", "Plus Jakarta Sans", "Inter", "ui-sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        // Brand — biru elektrik (refresh dari design: --brand-primary #5b8bff)
        brand: {
          50: "#eef4ff",
          100: "#dde8ff",
          200: "#bcd0ff",
          300: "#8eb1ff",
          400: "#5b8bff",   // primary aksen design
          500: "#3e6df5",
          600: "#2d54e0",   // gradient end
          700: "#2742b8",
          800: "#243891",
          900: "#1f3274",
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
        // Glow brand button (dark mode)
        glow: "0 4px 20px rgba(91,139,255,0.35)",
        // Card light mode
        card: "0 2px 16px rgba(0,0,0,0.08)",
      },
      keyframes: {
        pageIn: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        pulseRing: {
          "0%": { transform: "translate(-50%,-50%) scale(1)", opacity: "0.8" },
          "100%": { transform: "translate(-50%,-50%) scale(2.8)", opacity: "0" },
        },
      },
      animation: {
        "page-in": "pageIn 0.22s ease-out",
        "pulse-ring": "pulseRing 1.4s ease-out infinite",
      },
    },
  },
  plugins: [],
};
