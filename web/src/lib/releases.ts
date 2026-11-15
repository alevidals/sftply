import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const REPO = "alevidals/sftply"
const API = `https://api.github.com/repos/${REPO}/releases/latest`

export const RELEASES_URL = `https://github.com/${REPO}/releases`
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`
export const REPO_URL = `https://github.com/${REPO}`

export interface ReleaseAsset {
  name: string
  url: string
  bytes: number
}

export interface ReleaseInfo {
  version: string
  /** Release page, or the latest-release redirect when nothing was found. */
  url: string
  assets: ReleaseAsset[]
  /** True when the data came from the GitHub API during this build. */
  live: boolean
}

interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubRelease {
  tag_name: string
  html_url: string
  draft: boolean
  assets: GitHubAsset[]
}

function packageVersion(): string {
  const path = fileURLToPath(new URL("../../../package.json", import.meta.url))
  const pkg = JSON.parse(readFileSync(path, "utf8")) as { version?: string }
  return pkg.version ?? "0.0.0"
}

function offline(): ReleaseInfo {
  return { version: packageVersion(), url: LATEST_RELEASE_URL, assets: [], live: false }
}

/**
 * Resolve the newest published release at build time. CI passes a token so the
 * request is authenticated; a local build without one falls back to links that
 * point at the `/releases/latest` redirect.
 */
export async function loadRelease(): Promise<ReleaseInfo> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "sftply-site",
  }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const response = await fetch(API, { headers, signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`)
    const data = (await response.json()) as GitHubRelease
    if (data.draft) throw new Error("latest release is still a draft")
    return {
      version: data.tag_name.replace(/^v/, ""),
      url: data.html_url,
      assets: data.assets.map((asset) => ({
        name: asset.name,
        url: asset.browser_download_url,
        bytes: asset.size,
      })),
      live: true,
    }
  } catch (error) {
    console.warn(`[releases] falling back to static links: ${(error as Error).message}`)
    return offline()
  }
}

/** Find the first asset whose name ends with `suffix`, case-insensitively. */
export function findAsset(release: ReleaseInfo, suffix: string): ReleaseAsset | undefined {
  return release.assets.find((asset) => asset.name.toLowerCase().endsWith(suffix.toLowerCase()))
}

const fileSize = new Intl.NumberFormat("en", { maximumFractionDigits: 1 })

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return ""
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${fileSize.format(mb)}\u00a0MB`
  return `${Math.max(1, Math.round(bytes / 1024))}\u00a0KB`
}
