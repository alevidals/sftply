;(() => {
  try {
    const mode = localStorage.getItem("sftply.theme") || "dark"
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    const dark = mode === "dark" || (mode === "system" && prefersDark)
    const root = document.documentElement
    root.classList.toggle("dark", dark)
    root.style.colorScheme = dark ? "dark" : "light"

    const density = localStorage.getItem("sftply.density")
    if (density === "compact" || density === "comfortable") {
      root.dataset.density = density
    } else {
      root.dataset.density = "compact"
    }
  } catch {
    /* Appearance is cosmetic; ignore unavailable storage. */
  }
})()
