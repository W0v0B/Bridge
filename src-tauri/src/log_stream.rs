use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader, AsyncRead};
use tokio::time::Instant;

/// Generic batch-stream loop for reading lines from a child process stdout,
/// parsing each line into an entry, optionally filtering, and emitting batches.
///
/// - `reader`: async line reader (typically from child stdout)
/// - `parse_fn`: converts a raw line into an optional entry
/// - `filter_fn`: optional predicate — if `None`, all parsed entries pass
/// - `emit_fn`: called with each non-empty batch of entries
///
/// Batches at most 64 entries or 50ms, whichever comes first.
pub async fn batch_stream_loop<E, P, F, Em>(
    reader: BufReader<impl AsyncRead + Unpin>,
    parse_fn: P,
    filter_fn: Option<F>,
    mut emit_fn: Em,
) where
    P: Fn(&str) -> Option<E>,
    F: Fn(&E) -> bool,
    Em: FnMut(Vec<E>),
{
    let mut lines = reader.lines();
    let mut batch: Vec<E> = Vec::with_capacity(64);
    let mut last_flush = Instant::now();
    let flush_interval = Duration::from_millis(50);

    loop {
        let maybe_line = tokio::time::timeout(flush_interval, lines.next_line()).await;

        match maybe_line {
            Ok(Ok(Some(line))) => {
                if let Some(entry) = parse_fn(&line) {
                    let pass = match &filter_fn {
                        Some(f) => f(&entry),
                        None => true,
                    };
                    if pass {
                        batch.push(entry);
                    }
                }
                if batch.len() >= 64 || last_flush.elapsed() >= flush_interval {
                    if !batch.is_empty() {
                        emit_fn(std::mem::take(&mut batch));
                    }
                    last_flush = Instant::now();
                }
            }
            Ok(Ok(None)) | Ok(Err(_)) => {
                // EOF or read error — flush remaining and exit
                if !batch.is_empty() {
                    emit_fn(batch);
                }
                break;
            }
            Err(_) => {
                // Timeout — flush partial batch
                if !batch.is_empty() {
                    emit_fn(std::mem::take(&mut batch));
                    last_flush = Instant::now();
                }
            }
        }
    }
}
