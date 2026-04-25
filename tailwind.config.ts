import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      colors: {
        navy: "#264573",
        "navy-light": "#EEF2FA",
        "navy-mid": "#D6E0F0",
        pink: "#E8396A",
        "pink-light": "#FEF0F4",
        mint: "#3ECFAF",
        "mint-light": "#EDFAF7",
      },
    },
  },
  plugins: [],
};

export default config;
