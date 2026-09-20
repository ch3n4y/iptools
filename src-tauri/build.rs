fn main() {
    // The application manages network adapters, MAC addresses, host name and
    // workgroup, so — like the original tool — it must run elevated.
    let attributes = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new()
            .app_manifest(include_str!("windows-app-manifest.xml")),
    );

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
