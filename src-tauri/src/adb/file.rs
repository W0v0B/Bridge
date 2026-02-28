pub async fn push_file(serial: &str, local_path: &str, remote_path: &str) -> Result<(), String> {
    // TODO: Implement ADB push
    Ok(())
}

pub async fn pull_file(serial: &str, remote_path: &str, local_path: &str) -> Result<(), String> {
    // TODO: Implement ADB pull
    Ok(())
}

pub async fn list_directory(serial: &str, path: &str) -> Result<Vec<FileEntry>, String> {
    // TODO: Implement directory listing
    Ok(vec![])
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
}
