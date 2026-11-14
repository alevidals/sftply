import { defineConfig } from "astro/config"

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
})
