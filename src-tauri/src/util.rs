use tokio::process::Command;

/// Create a `Command` that won't spawn a visible console window on Windows.
///
/// In production (GUI app with no attached console), every `Command::new()`
/// call creates a brief console window flash.  The `CREATE_NO_WINDOW` flag
/// suppresses this.
pub fn cmd(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}
