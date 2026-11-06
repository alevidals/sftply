export interface Breadcrumb {
  label: string
  path: string
}

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC = /^\\\\[^\\]+\\[^\\]+/

/** Build clickable breadcrumb segments for a local absolute path. */
export function pathBreadcrumbs(path: string): Breadcrumb[] {
  if (!path) return []

  const unc = WINDOWS_UNC.exec(path)
  if (unc) {
    const root = unc[0]
    const rest = path.slice(root.length).split(/[\\/]/).filter(Boolean)
    let current = root
    const crumbs: Breadcrumb[] = [{ label: root, path: root }]
    for (const part of rest) {
      current = `${current}\\${part}`
      crumbs.push({ label: part, path: current })
    }
    return crumbs
  }

  const drive = WINDOWS_DRIVE.exec(path)
  if (drive) {
    const root = drive[0]
    const rest = path.slice(root.length).split(/[\\/]/).filter(Boolean)
    let current = root
    const crumbs: Breadcrumb[] = [{ label: root, path: root }]
    for (const part of rest) {
      current =
        current.endsWith("\\") || current.endsWith("/")
          ? `${current}${part}`
          : `${current}\\${part}`
      crumbs.push({ label: part, path: current })
    }
    return crumbs
  }

  if (path.startsWith("/")) {
    const parts = path.split("/").filter(Boolean)
    const crumbs: Breadcrumb[] = [{ label: "/", path: "/" }]
    let current = ""
    for (const part of parts) {
      current = `${current}/${part}`
      crumbs.push({ label: part, path: current })
    }
    return crumbs
  }

  return [{ label: path, path }]
}

/** Best-effort parent path used only when the backend did not supply one. */
export function parentPath(path: string): string | null {
  const crumbs = pathBreadcrumbs(path)
  if (crumbs.length <= 1) return null
  return crumbs[crumbs.length - 2]?.path ?? null
}

/** Last path segment used as a compact pane subtitle. */
export function pathLeaf(path: string): string {
  const crumbs = pathBreadcrumbs(path)
  return crumbs[crumbs.length - 1]?.label ?? path
}
