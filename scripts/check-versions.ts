import { readFileSync } from "node:fs"

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

const pkg = readJson<{ version: string }>("package.json")
const tauri = readJson<{ version: string }>("src-tauri/tauri.conf.json")
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8")
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]

const versions = new Map<string, string | undefined>([
  ["package.json", pkg.version],
  ["src-tauri/tauri.conf.json", tauri.version],
  ["src-tauri/Cargo.toml", cargoVersion],
])

const unique = new Set(versions.values())
if (unique.size !== 1 || unique.has(undefined)) {
  console.error("Version mismatch:")
  for (const [file, version] of versions) {
    console.error(`  ${file}: ${version ?? "missing"}`)
  }
  process.exit(1)
}

const version = pkg.version
const tag = process.env.GITHUB_REF_NAME
if (tag?.startsWith("v") && tag.slice(1) !== version) {
  console.error(`Tag ${tag} does not match the app version ${version}.`)
  process.exit(1)
}

console.log(`Version ${version} is consistent${tag ? ` with ${tag}` : ""}.`)
