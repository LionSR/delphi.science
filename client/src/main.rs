//! `delphi-p2p`: publish, fetch and check research artifacts between clients, with no server in
//! the middle.
//!
//! Claims are p2panda operations and files are iroh-blobs collections. This program is the
//! thin part between them: what a claim says, where things live on disk, and the commands.

mod check;
mod claim;
mod control;
mod files;
mod home;
mod index;
mod node;
mod ops;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use iroh_blobs::Hash;
use tokio::sync::Semaphore;

use crate::home::{Bootstrap, Config, Home};
use crate::node::Node;
use crate::ops::Command;

#[derive(Parser)]
#[command(
    name = "delphi-p2p",
    version,
    about = "Publish, fetch and check research artifacts peer to peer."
)]
struct Cli {
    /// The client's directory. Default: $DELPHI_P2P_HOME, then ~/.delphi/p2p.
    #[arg(long, global = true)]
    home: Option<PathBuf>,
    /// Seconds a command that wrote claims stays up so that other clients can receive them,
    /// when no `delphi-p2p serve` is running.
    #[arg(long, global = true, default_value_t = 8)]
    linger: u64,
    #[command(subcommand)]
    command: Top,
}

#[derive(Subcommand)]
enum Top {
    /// Create this client's keys and settings.
    Init {
        /// A relay to connect through. May be given more than once.
        #[arg(long = "relay")]
        relays: Vec<String>,
        /// Another client to start from, as <its key>@<its relay URL>. May be given more than once.
        #[arg(long = "bootstrap")]
        bootstrap: Vec<String>,
        /// The agent that will use this client, written into its claims.
        #[arg(long)]
        agent: Option<String>,
        /// Do not look for other clients on the local network.
        #[arg(long)]
        no_mdns: bool,
    },
    /// Stay up: keep in sync with other clients and serve files to them. Starts no agent.
    Serve {
        /// Also fetch the files of every version this client hears of, and serve those too.
        #[arg(long)]
        mirror: bool,
    },
    #[command(flatten)]
    Run(Command),
}

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        eprintln!("delphi-p2p: {err:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    let home = Home::locate(cli.home)?;
    match cli.command {
        Top::Init {
            relays,
            bootstrap,
            agent,
            no_mdns,
        } => init(&home, relays, bootstrap, agent, no_mdns).await,
        Top::Serve { mirror } => serve(home, mirror).await,
        Top::Run(command) => {
            let command = command.absolute()?;
            home.keys()?;
            let started = Instant::now();
            let _lock = loop {
                // A running client holds the stores, so it does the work.
                if let Some(reply) = control::send(&home.socket(), &command).await? {
                    print!("{}", reply?);
                    return Ok(());
                }
                if let Some(lock) = home.lock()? {
                    break lock;
                }
                // Another command is using the directory and will be done soon.
                if started.elapsed() > Duration::from_secs(120) {
                    bail!(
                        "another delphi-p2p command has held {} for two minutes",
                        home.dir.display()
                    );
                }
                tokio::time::sleep(Duration::from_millis(300)).await;
            };
            let node = Node::spawn(home, false).await?;
            let writes = command.writes();
            if !writes {
                node.settle(Duration::from_secs(3)).await;
            }
            let result = ops::run(&node, command).await;
            if writes && result.is_ok() {
                node.settle(Duration::from_secs(cli.linger)).await;
                if !node.met_someone() {
                    eprintln!("delphi-p2p: no other client was reachable; the claims go out the next time one is.");
                }
            }
            node.shutdown().await;
            print!("{}", result?);
            Ok(())
        }
    }
}

async fn init(
    home: &Home,
    relays: Vec<String>,
    bootstrap: Vec<String>,
    agent: Option<String>,
    no_mdns: bool,
) -> Result<()> {
    let mut peers = Vec::new();
    for peer in bootstrap {
        let (node, relay) = peer
            .split_once('@')
            .with_context(|| format!("--bootstrap {peer}: expected <key>@<relay URL>"))?;
        peers.push(Bootstrap {
            node: node.to_string(),
            relay: relay.to_string(),
        });
    }
    let fresh = !home.exists();
    let config = if fresh || !relays.is_empty() || !peers.is_empty() || agent.is_some() || no_mdns {
        let old = home.config()?;
        Config {
            relays: if relays.is_empty() { old.relays } else { relays },
            bootstrap: if peers.is_empty() { old.bootstrap } else { peers },
            agent: agent.or(old.agent),
            mdns: !no_mdns && old.mdns,
        }
    } else {
        home.config()?
    };
    home.init(&config)?;
    let _lock = home
        .lock()?
        .context("another delphi-p2p process is using this directory")?;
    let node = Node::spawn(home.clone(), false).await?;
    println!("Node: {}", node.me);
    println!("Home: {}", home.dir.display());
    if config.relays.is_empty() {
        println!("Relays: none (local network only)");
    } else {
        println!("Relays: {}", config.relays.join(", "));
    }
    node.shutdown().await;
    Ok(())
}

async fn serve(home: Home, mirror: bool) -> Result<()> {
    home.keys()?;
    let _lock = home
        .lock()?
        .with_context(|| format!("another delphi-p2p process is using {}", home.dir.display()))?;
    // The socket opens before the node starts, so a command typed meanwhile waits for it.
    let socket = home.socket();
    let listener = control::bind(&socket)?;
    let node = Arc::new(Node::spawn(home.clone(), true).await?);
    eprintln!("delphi-p2p: serving as {}", node.me);
    if let Err(err) = node.announce_all_held().await {
        eprintln!("delphi-p2p: could not announce the files held: {err:#}");
    }
    if mirror {
        tokio::spawn(mirror_all(node.clone()));
    }
    let mut stopped = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        result = control::serve(listener, node.clone()) => result?,
        _ = tokio::signal::ctrl_c() => {}
        _ = stopped.recv() => {}
    }
    let _ = std::fs::remove_file(&socket);
    Ok(())
}

/// How many versions a mirror fetches at once: those whose claim just arrived, and those it tries
/// again. The two do not share slots, so versions whose holders are gone never keep a new one
/// waiting while its author is still there.
const MIRROR_NEW: usize = 8;
const MIRROR_AGAIN: usize = 4;

struct Slots {
    new: Semaphore,
    again: Semaphore,
}

/// Fetches the files of every version as its claim arrives, and says so.
async fn mirror_all(node: Arc<Node>) {
    let slots = Arc::new(Slots {
        new: Semaphore::new(MIRROR_NEW),
        again: Semaphore::new(MIRROR_AGAIN),
    });
    let mut arrivals = node.index.arrivals();
    let mut seen = 0;
    // Versions known before this client started are tried like those tried again.
    let mut started = false;
    loop {
        let versions = match node.index.since(seen, Some("publish"), 500).await {
            Ok(versions) => versions,
            Err(err) => {
                eprintln!("delphi-p2p: mirror: {err}");
                return;
            }
        };
        for stored in &versions {
            seen = stored.seq;
            let Some(publish) = stored.claim.read::<claim::Publish>() else {
                continue;
            };
            let Ok(hash) = publish.snapshot.parse() else { continue };
            tokio::spawn(mirror(
                node.clone(),
                slots.clone(),
                started,
                stored.id.clone(),
                publish.snapshot,
                hash,
            ));
        }
        if versions.is_empty() {
            started = true;
            if arrivals.changed().await.is_err() {
                return;
            }
        }
    }
}

/// Fetches the files of one version and says that this client holds them. The author may run one
/// command and be gone before the files are across, so a fetch that fails is tried again: after a
/// minute, then at twice the interval each time up to an hour, for a week.
async fn mirror(node: Arc<Node>, slots: Arc<Slots>, new: bool, version: String, snapshot: String, hash: Hash) {
    let begun = Instant::now();
    let mut pause = Duration::from_secs(60);
    let mut first = true;
    loop {
        let (slot, patience) = if first && new {
            (&slots.new, Duration::from_secs(120))
        } else {
            (&slots.again, Duration::from_secs(20))
        };
        let fetched = match slot.acquire().await {
            Ok(_held) => node.fetch(hash, patience).await,
            Err(_) => return,
        };
        match fetched {
            Ok(()) => {
                if let Err(err) = node.announce_holding(&version, &snapshot, None).await {
                    eprintln!("delphi-p2p: mirror: {err}");
                }
                return;
            }
            Err(err) if begun.elapsed() > Duration::from_secs(7 * 24 * 3600) => {
                eprintln!("delphi-p2p: mirror: gave up on version {version}: {err}");
                return;
            }
            Err(err) if first => eprintln!("delphi-p2p: mirror: {err}; it will be tried again"),
            Err(_) => {}
        }
        first = false;
        tokio::time::sleep(pause).await;
        pause = (pause * 2).min(Duration::from_secs(3600));
    }
}
