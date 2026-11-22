//! The control socket of a running client.
//!
//! The stores can be open in one process only. While `delphi-p2p serve` runs, the other commands
//! send themselves to it over a Unix socket in the client's directory and print its reply.

use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::node::Node;
use crate::ops::{self, Command};

#[derive(Serialize, Deserialize)]
enum Reply {
    Done(String),
    Failed(String),
}

/// Sends a command to the client running on this directory. `None` when none is running.
pub async fn send(socket: &Path, command: &Command) -> Result<Option<Result<String>>> {
    let Ok(mut stream) = UnixStream::connect(socket).await else {
        return Ok(None);
    };
    stream
        .write_all((serde_json::to_string(command)? + "\n").as_bytes())
        .await?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).await?;
    let reply: Reply = serde_json::from_str(&line).context("the running client sent no reply")?;
    Ok(Some(match reply {
        Reply::Done(text) => Ok(text),
        Reply::Failed(error) => Err(anyhow::anyhow!(error)),
    }))
}

/// Opens the socket. Commands that connect from now on wait in its queue until `serve` runs.
pub fn bind(socket: &Path) -> Result<UnixListener> {
    // A socket file left by a client that was killed would refuse the bind.
    let _ = std::fs::remove_file(socket);
    UnixListener::bind(socket).with_context(|| format!("{}", socket.display()))
}

/// Answers commands on the socket until the process is stopped.
pub async fn serve(listener: UnixListener, node: Arc<Node>) -> Result<()> {
    loop {
        let (stream, _) = listener.accept().await?;
        let node = node.clone();
        tokio::spawn(async move {
            if let Err(err) = answer(stream, &node).await {
                eprintln!("delphi-p2p: control socket: {err}");
            }
        });
    }
}

async fn answer(stream: UnixStream, node: &Node) -> Result<()> {
    let (read, mut write) = stream.into_split();
    let mut line = String::new();
    BufReader::new(read).read_line(&mut line).await?;
    let reply = match serde_json::from_str::<Command>(&line) {
        Ok(command) => match ops::run(node, command).await {
            Ok(text) => Reply::Done(text),
            Err(err) => Reply::Failed(format!("{err:#}")),
        },
        Err(err) => Reply::Failed(format!("not a command: {err}")),
    };
    write
        .write_all((serde_json::to_string(&reply)? + "\n").as_bytes())
        .await?;
    Ok(())
}
