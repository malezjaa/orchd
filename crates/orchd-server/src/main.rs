#[tokio::main]
async fn main() -> anyhow::Result<()> {
  orchd_server::init_tracing();
  orchd_server::run().await
}
