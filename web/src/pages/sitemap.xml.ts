import type { APIRoute } from "astro"

const basePath = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`

export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL("https://alevidals.github.io")
  const pageUrl = new URL(basePath, origin).href
  const lastmod = new Date().toISOString().slice(0, 10)
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${pageUrl}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } })
}
