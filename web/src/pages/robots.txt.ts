import type { APIRoute } from "astro"

const basePath = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`

export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL("https://alevidals.github.io")
  const sitemap = new URL(`${basePath}sitemap.xml`, origin).href
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
