//! Stable error codes and the serializable error payload crossing the Tauri boundary.
//!
//! The UI branches on `code`, never on `message`: messages are localized prose for
//! humans, codes are the contract (see docs/CONTRACT.md).

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    /// The process is not elevated, but the operation needs administrator rights.
    NotElevated,
    /// No adapter matches the requested identifier.
    AdapterNotFound,
    /// Caller supplied input that failed validation (IP, mask, name, ...).
    InvalidInput,
    /// A referenced resource (scheme, file, job) does not exist.
    NotFound,
    /// Filesystem failure while reading/writing configuration.
    IoError,
    /// An external command (netsh, ...) reported failure.
    CommandFailed,
    /// The write was issued but the read-back did not match the requested state.
    VerifyFailed,
    /// The operation is not supported on this system.
    NotSupported,
    /// Another operation is already running.
    Busy,
    /// Anything else; `detail` carries the raw diagnostic.
    Unknown,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            ErrorCode::NotElevated => "NOT_ELEVATED",
            ErrorCode::AdapterNotFound => "ADAPTER_NOT_FOUND",
            ErrorCode::InvalidInput => "INVALID_INPUT",
            ErrorCode::NotFound => "NOT_FOUND",
            ErrorCode::IoError => "IO_ERROR",
            ErrorCode::CommandFailed => "COMMAND_FAILED",
            ErrorCode::VerifyFailed => "VERIFY_FAILED",
            ErrorCode::NotSupported => "NOT_SUPPORTED",
            ErrorCode::Busy => "BUSY",
            ErrorCode::Unknown => "UNKNOWN",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub detail: Option<String>,
    pub hint: Option<String>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
            hint: None,
        }
    }

    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        let detail = detail.into();
        if !detail.trim().is_empty() {
            self.detail = Some(detail);
        }
        self
    }

    pub fn hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        AppError::new(ErrorCode::InvalidInput, message)
    }

    pub fn not_elevated(operation: &str) -> Self {
        AppError::new(
            ErrorCode::NotElevated,
            "当前进程没有管理员权限，无法执行该操作",
        )
        .detail(format!("被拒绝的操作：{operation}"))
        .hint("请使用界面右上角的“以管理员身份重启”后再试")
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 4)?;
        state.serialize_field("code", self.code.as_str())?;
        state.serialize_field("message", &self.message)?;
        state.serialize_field("detail", &self.detail)?;
        state.serialize_field("hint", &self.hint)?;
        state.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::new(ErrorCode::IoError, "文件操作失败").detail(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::new(ErrorCode::InvalidInput, "配置文件解析失败").detail(err.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Maps a Win32 error code from a failed API call into an AppError.
#[cfg(windows)]
pub fn win32_error(code: u32, context: &str) -> AppError {
    let mapped = match code {
        5 => ErrorCode::NotElevated,   // ERROR_ACCESS_DENIED
        2 | 3 => ErrorCode::NotFound,  // ERROR_FILE_NOT_FOUND / ERROR_PATH_NOT_FOUND
        1168 => ErrorCode::NotFound,   // ERROR_ELEMENT_NOT_FOUND
        _ => ErrorCode::CommandFailed,
    };
    AppError::new(mapped, context.to_string()).detail(format!("Win32 错误码：{code}"))
}
