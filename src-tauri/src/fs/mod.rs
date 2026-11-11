pub mod local;
pub mod path;

use async_trait::async_trait;

use crate::error::AppError;

/// Streaming reader returned by a filesystem backend. `finish` is explicit
/// because FTP data connections must read the server's completion reply and
/// SFTP handles must be closed deterministically.
#[async_trait]
pub trait FileReader: Send {
    async fn read(&mut self, buf: &mut [u8]) -> Result<usize, AppError>;
    async fn finish(self: Box<Self>) -> Result<(), AppError>;
}

/// Streaming writer returned by a filesystem backend. A transfer is never
/// reported as complete before `finish` succeeds.
#[async_trait]
pub trait FileWriter: Send {
    async fn write(&mut self, buf: &[u8]) -> Result<usize, AppError>;
    async fn finish(self: Box<Self>) -> Result<(), AppError>;
    async fn abort(self: Box<Self>) -> Result<(), AppError>;
}
