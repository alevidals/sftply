//! Regenerate `src/lib/ipc/bindings.ts` without launching the desktop app.
//!
//! Usage (from `src-tauri`): `cargo run --bin export-bindings`

fn main() {
    sftply_lib::export_bindings().expect("failed to export TypeScript bindings");
    println!("Wrote ../src/lib/ipc/bindings.ts");
}
