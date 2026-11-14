//! Regenerate `src/lib/ipc/bindings.ts` without launching the desktop app.
//!
//! Usage (from `src-tauri`): `cargo run --example export-bindings`
//!
//! This is an example and not a `src/bin` target on purpose: Tauri's universal
//! macOS bundler copies every binary target next to the app, and `lipo` is only
//! run on the main executable, so an extra bin breaks `tauri build`.

fn main() {
    sftply_lib::export_bindings().expect("failed to export TypeScript bindings");
    println!("Wrote ../src/lib/ipc/bindings.ts");
}
