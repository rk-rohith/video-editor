import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "#0b0b0e",
        panel: "#121216",
        panelAlt: "#17171c",
        border: "#26262e",
        accent: "#7c5cff",
        accentSoft: "#3a2f66",
        textPrimary: "#f2f2f5",
        textMuted: "#8b8b96",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
