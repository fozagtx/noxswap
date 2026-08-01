import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0f",
        panel: "#12121a",
        edge: "#23232f",
        glow: "#8b7cf6",
        mint: "#34d399",
      },
    },
  },
  plugins: [],
};

export default config;
