use futures::stream::{BoxStream, StreamExt};
use orchd_core::{Frame, Framing};
use tokio::io::AsyncRead;
use tokio_util::codec::{FramedRead, LinesCodec};

/// Turn one subprocess's stdout into a stream of protocol `Frame`s per the
/// adapter's declared `Framing`. Codex app-server currently uses the same
/// newline-delimited transport as Claude Code. Content-length framing remains
/// available for adapters that need it.
pub fn framed_stream<R>(
  stdout: R,
  framing: Framing,
) -> BoxStream<'static, std::io::Result<Frame>>
where
  R: AsyncRead + Unpin + Send + 'static,
{
  match framing {
    Framing::LineDelimitedJson => FramedRead::new(stdout, LinesCodec::new())
      .map(|line| {
        line
          .map(|l| Frame(l.into_bytes()))
          .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))
      })
      .boxed(),
    Framing::ContentLengthJsonRpc => {
      unimplemented!("Content-Length JSON-RPC framing has no active adapter")
    }
    Framing::Raw => unimplemented!("Raw framing has no adapter using it yet"),
  }
}
