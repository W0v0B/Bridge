use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub adb_path: String,
    pub auto_connect: bool,
    pub theme: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            adb_path: String::new(),
            auto_connect: true,
            theme: "dark".to_string(),
        }
    }
}
