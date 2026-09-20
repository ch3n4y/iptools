//! Elevation detection and self-elevation.
//!
//! The bundled application declares `requireAdministrator`, so the check below
//! only reports `false` in development runs, when a user launched the binary
//! from a context that stripped the manifest, or when elevation was denied.

use std::os::windows::ffi::OsStrExt;
use std::process::Command;

use windows::core::PCWSTR;
use windows::Win32::UI::Shell::{IsUserAnAdmin, ShellExecuteW};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use crate::error::{AppError, AppResult, ErrorCode};

pub fn is_elevated() -> bool {
    unsafe { IsUserAnAdmin().as_bool() }
}

pub fn require_elevation(operation: &str) -> AppResult<()> {
    if is_elevated() {
        Ok(())
    } else {
        Err(AppError::not_elevated(operation))
    }
}

fn wide(text: &std::ffi::OsStr) -> Vec<u16> {
    text.encode_wide().chain(std::iter::once(0)).collect()
}

/// Starts an elevated copy of this executable and returns immediately.
pub fn relaunch_elevated(arguments: &[String]) -> AppResult<()> {
    let exe = std::env::current_exe()
        .map_err(|err| AppError::new(ErrorCode::IoError, "无法定位程序自身路径").detail(err.to_string()))?;

    let verb: Vec<u16> = wide(std::ffi::OsStr::new("runas"));
    let file: Vec<u16> = wide(exe.as_os_str());
    let params: Vec<u16> = wide(std::ffi::OsStr::new(&arguments.join(" ")));

    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR(params.as_ptr()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW returns a value <= 32 on failure.
    if result.0 as isize <= 32 {
        return Err(AppError::new(
            ErrorCode::NotElevated,
            "提权启动失败，可能被用户取消或被安全软件拦截",
        )
        .detail(format!("ShellExecuteW 返回 {}", result.0 as isize))
        .hint("也可以右键程序图标，选择“以管理员身份运行”"));
    }
    Ok(())
}

/// Opens a Windows control-panel page (used for F12 → 网络连接).
pub fn open_control_panel(page: &str) -> AppResult<()> {
    Command::new("control.exe")
        .arg(page)
        .spawn()
        .map_err(|err| {
            AppError::new(ErrorCode::CommandFailed, "无法打开控制面板")
                .detail(format!("{page}：{err}"))
        })?;
    Ok(())
}
