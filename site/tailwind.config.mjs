/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        accent: "#2563EB",
        background: "#FFFFFF",
        surface: "#F8F9FA",
        border: "#E5E7EB",
        muted: "#6B7280",
        heading: "#1F2937",
        body: "#1F2937",
        success: "#16A34A",
        warning: "#D97706",
        error: "#DC2626",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      fontSize: {
        // 18px body — avoid the name "body" (collides with colors.body → text-body)
        content: ["1.125rem", { lineHeight: "1.7" }],
        small: ["0.9375rem", { lineHeight: "1.6" }],
        h4: ["1.375rem", { lineHeight: "1.35" }],
        h3: ["1.75rem", { lineHeight: "1.3" }],
        h2: ["2.125rem", { lineHeight: "1.25" }],
        h1: ["2.75rem", { lineHeight: "1.15" }],
        "h1-lg": ["3.25rem", { lineHeight: "1.15" }],
      },
      fontWeight: {
        light: "300",
        normal: "400",
        semibold: "600",
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
      },
      maxWidth: {
        article: "50rem",
        container: "67.5rem",
      },
      borderRadius: {
        btn: "0.5rem",
        card: "0.625rem",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.04)",
      },
    },
  },
  plugins: [],
};
