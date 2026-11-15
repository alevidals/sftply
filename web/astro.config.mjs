import { defineConfig, fontProviders } from "astro/config"

// Deployment is environment driven so the same build works on GitHub Pages
// (project subpath) and on Vercel or a custom domain (root path):
//
//   SITE_URL=https://alevidals.github.io SITE_BASE=/sftply  (default)
//   SITE_URL=https://sftply.app          SITE_BASE=/        (custom domain)
const site = process.env.SITE_URL || "https://alevidals.github.io"
const base = process.env.SITE_BASE || "/sftply"

export default defineConfig({
  site,
  base,
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
  devToolbar: { enabled: false },
  fonts: [
    {
      provider: fontProviders.google(),
      name: "Work Sans",
      cssVariable: "--font-work-sans",
      weights: ["100 900"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["sans-serif"],
    },
    {
      provider: fontProviders.google(),
      name: "JetBrains Mono",
      cssVariable: "--font-jetbrains-mono",
      weights: ["400 700"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["monospace"],
    },
  ],
})
