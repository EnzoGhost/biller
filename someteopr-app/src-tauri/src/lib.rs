use tauri_plugin_sql::{Migration, MigrationKind};
use std::process::Command;

// ── File I/O commands for ImPlug folder integration ──────────────────────────

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn write_edi_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_edi_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_era_files(folder: String) -> Result<Vec<String>, String> {
    let dir = std::path::Path::new(&folder);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut files = vec![];
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext == "835" || ext == "edi" || ext == "txt" {
                files.push(path.to_string_lossy().to_string());
            }
        }
    }
    Ok(files)
}

#[tauri::command]
fn copy_file_native(src: String, dest: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_app_data_dir() -> Result<String, String> {
    dirs::data_dir()
        .map(|p| p.join("com.someteopr.app").to_string_lossy().to_string())
        .ok_or_else(|| "Cannot determine data dir".to_string())
}

// ── Main entry point ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_schema",
            sql: include_str!("../migrations/001_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "seed_data",
            sql: include_str!("../migrations/002_seed.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:someteopr.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            open_file,
            write_edi_file,
            read_edi_file,
            list_era_files,
            copy_file_native,
            get_app_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SometeoPR");
}
