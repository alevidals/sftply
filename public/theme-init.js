;(() => {
  try {
    // Keep in sync with src/lib/themes.ts. The bootstrap cannot import the
    // module graph, so it carries the minimal id -> dark mapping itself.
    const palettes = {
      dark: true,
      light: false,
      oneDark: true,
      gruvboxDark: true,
      gruvboxLight: false,
      nord: true,
      dracula: true,
      solarizedLight: false,
      tokyoNight: true,
      catppuccinMocha: true,
    }

    const stored = localStorage.getItem("sftply.theme") || "dark"
    const known = stored === "system" || Object.keys(palettes).includes(stored)
    const mode = known ? stored : "dark"
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    const dark = mode === "system" ? prefersDark : palettes[mode]
    const id = mode === "system" ? (prefersDark ? "dark" : "light") : mode

    const root = document.documentElement
    root.classList.toggle("dark", dark)
    root.dataset.theme = id
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
