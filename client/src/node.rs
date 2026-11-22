//! A running client: p2panda for claims, iroh-blobs for files, side by side.
//!
//! The two libraries each keep their own connection. p2panda does not let another protocol share
//! its endpoint, so files travel over a second iroh endpoint with its own key.

use std::time::Duration;

use anyhow::{Context, Result, bail};
use futures_util::StreamExt;
use iroh::address_lookup::MemoryLookup;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{EndpointAddr, EndpointId, RelayMode, RelayUrl};
use iroh_blobs::api::downloader::{DownloadProgress, DownloadProgressItem, Shuffled};
use iroh_blobs::protocol::GetRequest;
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::{BlobsProtocol, Hash};
use p2panda::network::MdnsDiscoveryMode;
use p2panda::node::AckPolicy;
use p2panda::streams::{StreamEvent, StreamPublisher, StreamSubscription};
use tokio::sync::watch;
use tokio::time::{Instant, sleep, timeout};

use crate::claim::{self, Claim, Kind};
use crate::files;
use crate::home::{Config, Home};
use crate::index::{Index, Stored};

/// Clients that use another name here never meet.
const NETWORK: &str = "delphi.science/1";
/// The one topic of the first version: every public record.
const TOPIC: &str = "delphi.science/1/records";

/// A claim goes out in one gossip message, and p2panda's default limit for one is 4096 bytes.
/// Staying under it keeps this client compatible with every other p2panda default.
const MAX_CLAIM_BYTES: usize = 3000;

/// How many always-on clients, learned from their claims, a client starts its search from.
const MAX_LEARNED_BOOTSTRAPS: i64 = 32;

/// A transfer that brings nothing for this long is given up.
const STALLED: Duration = Duration::from_secs(60);

pub struct Node {
    pub home: Home,
    pub config: Config,
    /// This client's public key, in hex: the author of its claims.
    pub me: String,
    pub index: Index,
    pub store: FsStore,
    /// Whether this client stays up (`delphi-p2p serve`). Only then is it worth telling others that
    /// it holds the files it fetched: a client that stops after one command cannot serve them.
    pub serving: bool,
    // Dropping the p2panda node stops its networking, so it lives as long as this does.
    _claims: p2panda::Node,
    publisher: StreamPublisher<Claim>,
    files: Router,
    lookup: MemoryLookup,
    sessions: watch::Receiver<u64>,
}

impl Node {
    pub async fn spawn(home: Home, serving: bool) -> Result<Self> {
        let config = home.config()?;
        let keys = home.keys()?;
        let index = Index::open(&home.index_db()).await?;

        let relays: Vec<RelayUrl> = config
            .relays
            .iter()
            .map(|url| {
                url.parse()
                    .with_context(|| format!("config.json: not a relay URL: {url}"))
            })
            .collect::<Result<_>>()?;

        let mut builder = p2panda::builder()
            .credentials(keys.claims.clone())
            .database_url(&format!("sqlite://{}", home.claims_db().display()))
            .network_id(*p2panda::Hash::digest(NETWORK).as_bytes())
            .ack_policy(AckPolicy::Explicit)
            .mdns_mode(if config.mdns {
                MdnsDiscoveryMode::Active
            } else {
                MdnsDiscoveryMode::Disabled
            });
        for relay in &relays {
            builder = builder.relay_url(relay.clone());
        }
        for peer in &config.bootstrap {
            let node = peer
                .node
                .parse()
                .with_context(|| format!("config.json: not a key: {}", peer.node))?;
            let relay = peer
                .relay
                .parse()
                .with_context(|| format!("config.json: not a relay URL: {}", peer.relay))?;
            builder = builder.bootstrap(node, relay);
        }
        let claims = builder.spawn().await.context("could not start the claims node")?;
        let me = claims.id().to_hex();

        // Besides the clients named in the settings, start from the ones that said they stay up.
        // Every client that has synced once knows some, so no single machine has to be there.
        for stored in index.latest_of_each::<claim::Endpoint>(MAX_LEARNED_BOOTSTRAPS).await? {
            let Some(endpoint) = stored.claim.read::<claim::Endpoint>() else {
                continue;
            };
            let (Ok(peer), Some(relay)) = (stored.author.parse(), endpoint.blobs.relay_urls().next()) else {
                continue;
            };
            if endpoint.serving && stored.author != me {
                let _ = claims.insert_bootstrap(peer, relay.clone()).await;
            }
        }

        let topic = p2panda::Topic::from(p2panda::Hash::digest(TOPIC));
        let (publisher, subscription) = claims
            .stream::<Claim>(topic)
            .await
            .context("could not open the records topic")?;
        let (ended, sessions) = watch::channel(0);
        tokio::spawn(consume(subscription, index.clone(), ended));

        let lookup = MemoryLookup::new();
        let relay_mode = if relays.is_empty() {
            RelayMode::Disabled
        } else {
            RelayMode::custom(relays)
        };
        let endpoint = iroh::Endpoint::builder(presets::Minimal)
            .secret_key(keys.blobs_key()?)
            .relay_mode(relay_mode)
            .address_lookup(lookup.clone())
            .bind()
            .await
            .context("could not open the file endpoint")?;
        let store = FsStore::load(home.blobs())
            .await
            .map_err(|err| anyhow::anyhow!("file store: {err}"))?;
        let files = Router::builder(endpoint)
            .accept(iroh_blobs::ALPN, BlobsProtocol::new(&store, None))
            .spawn();

        let node = Node {
            home,
            config,
            me,
            index,
            store,
            serving,
            _claims: claims,
            publisher,
            files,
            lookup,
            sessions,
        };
        node.announce().await?;
        Ok(node)
    }

    /// Signs a claim, stores it and hands it to the network. Returns its id.
    pub async fn publish<K: Kind>(&self, body: &K, refs: Vec<String>, agent: Option<String>) -> Result<String> {
        let claim = Claim::new(body, refs, agent.or_else(|| self.config.agent.clone()));
        let size = serde_json::to_vec(&claim)?.len();
        if size > MAX_CLAIM_BYTES {
            bail!("the claim is {size} bytes; the limit is {MAX_CLAIM_BYTES}");
        }
        let pending = self.publisher.publish(claim).await?;
        let id = pending.hash().to_hex();
        pending.await.context("the claim was not processed")?;
        // Our own claims come back through the same stream as everyone else's. Wait for that, so
        // the caller finds the claim in the index.
        self.wait_for(&id, Duration::from_secs(10))
            .await?
            .context("the claim did not reach the index")?;
        Ok(id)
    }

    /// The claim with this id, waiting up to `patience` for it to arrive from another client.
    pub async fn wait_for(&self, id: &str, patience: Duration) -> Result<Option<Stored>> {
        let deadline = Instant::now() + patience;
        let mut arrivals = self.index.arrivals();
        loop {
            if let Some(found) = self.index.get(id).await? {
                return Ok(Some(found));
            }
            if timeout(deadline - Instant::now(), arrivals.changed()).await.is_err() {
                return Ok(None);
            }
        }
    }

    /// Gives other clients time to hand over what this one lacks: until a sync has finished and
    /// nothing has arrived for a moment, or until `patience` runs out.
    pub async fn settle(&self, patience: Duration) {
        let deadline = Instant::now() + patience;
        let mut sessions = self.sessions.clone();
        if *sessions.borrow() == 0 && timeout(deadline - Instant::now(), sessions.changed()).await.is_err() {
            return;
        }
        let mut arrivals = self.index.arrivals();
        while Instant::now() < deadline {
            if timeout(Duration::from_millis(700), arrivals.changed()).await.is_err() {
                return;
            }
        }
    }

    /// Whether any other client has synced with this one since it started.
    pub fn met_someone(&self) -> bool {
        *self.sessions.borrow() > 0
    }

    /// Makes sure every file of the snapshot is in the local store, fetching what is missing from
    /// clients that say they hold it.
    pub async fn fetch(&self, snapshot: Hash, patience: Duration) -> Result<()> {
        let deadline = Instant::now() + patience;
        while !files::complete(&self.store, snapshot).await? {
            self.ask(snapshot, GetRequest::all(snapshot), deadline).await?;
        }
        Ok(())
    }

    /// The files of the snapshot: their names, sizes and hashes. Fetches the list, not the files.
    pub async fn list(&self, snapshot: Hash, patience: Duration) -> Result<Vec<files::Entry>> {
        let deadline = Instant::now() + patience;
        loop {
            if let Some(list) = files::list(&self.store, snapshot).await? {
                return Ok(list);
            }
            self.ask(snapshot, files::listing(snapshot), deadline).await?;
        }
    }

    /// One round of asking the clients that say they hold the snapshot for `request`. The caller
    /// looks in the store again afterwards. Fails once `deadline` has passed. The deadline is for
    /// a holder to be found and reached: a transfer that has started runs to its end, and after
    /// the deadline no client is asked.
    async fn ask(&self, snapshot: Hash, request: GetRequest, deadline: Instant) -> Result<()> {
        let mut problem = None;
        let holders = self.holders(snapshot).await?;
        let known = holders.len();
        if known > 0 && Instant::now() < deadline {
            let download = self
                .store
                .downloader(self.files.endpoint())
                .download(request, Shuffled::new(holders));
            match transfer(download).await {
                Ok(()) => return Ok(()),
                Err(err) => problem = Some(err.to_string()),
            }
        }
        if Instant::now() >= deadline {
            match problem {
                Some(err) => bail!("could not fetch snapshot {snapshot}: {err}"),
                None if known > 0 => bail!("snapshot {snapshot} is not in the local store"),
                None => bail!("no client that holds snapshot {snapshot} is known yet"),
            }
        }
        // A holder's claims may still be on their way, or it may be starting up.
        sleep(Duration::from_millis(500)).await;
        Ok(())
    }

    /// How many other clients say they hold the snapshot, waiting up to `patience` for the first.
    /// The author of a version runs one command and stops, so its files outlive that command only
    /// once another client has them.
    pub async fn other_holders(&self, snapshot: &str, patience: Duration) -> Result<usize> {
        let deadline = Instant::now() + patience;
        let mut arrivals = self.index.arrivals();
        loop {
            let holders = self.index.holders(snapshot).await?;
            let others = holders.iter().filter(|author| **author != self.me).count();
            if others > 0 || timeout(deadline - Instant::now(), arrivals.changed()).await.is_err() {
                return Ok(others);
            }
        }
    }

    /// Says "I hold this snapshot and serve it", once.
    pub async fn announce_holding(&self, version: &str, snapshot: &str, agent: Option<String>) -> Result<()> {
        if !self.index.holders(snapshot).await?.contains(&self.me) {
            let have = claim::Have {
                snapshot: snapshot.to_string(),
            };
            self.publish(&have, vec![version.to_string()], agent).await?;
        }
        Ok(())
    }

    /// Announces every snapshot that is complete in the store. A client that fetched files while
    /// it ran one command at a time says so here, once it stays up.
    pub async fn announce_all_held(&self) -> Result<()> {
        for stored in self.index.publishes().await? {
            let Some(publish) = stored.claim.read::<claim::Publish>() else {
                continue;
            };
            let Ok(hash) = publish.snapshot.parse() else { continue };
            if files::complete(&self.store, hash).await? {
                self.announce_holding(&stored.id, &publish.snapshot, None).await?;
            }
        }
        Ok(())
    }

    pub fn files_id(&self) -> EndpointId {
        self.files.endpoint().id()
    }

    pub async fn shutdown(self) {
        let _ = self.files.shutdown().await;
        let _ = self.store.shutdown().await;
    }

    /// File endpoints of the other clients that say they hold the snapshot.
    async fn holders(&self, snapshot: Hash) -> Result<Vec<EndpointId>> {
        let mut ids = Vec::new();
        for author in self.index.holders(&snapshot.to_string()).await? {
            if author == self.me {
                continue;
            }
            let Some(stored) = self.index.latest_by::<claim::Endpoint>(&author).await? else {
                continue;
            };
            let Some(endpoint) = stored.claim.read::<claim::Endpoint>() else {
                continue;
            };
            ids.push(endpoint.blobs.id);
            self.lookup.add_endpoint_info(endpoint.blobs);
        }
        Ok(ids)
    }

    /// Publishes where this client's file endpoint can be reached and whether it stays up, when
    /// either has changed.
    async fn announce(&self) -> Result<()> {
        let now = claim::Endpoint {
            blobs: self.files_addr().await,
            serving: self.serving,
        };
        let path = self.home.announced();
        let last: Option<claim::Endpoint> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok());
        if last.as_ref() != Some(&now) {
            self.publish(&now, vec![], None).await?;
            std::fs::write(&path, serde_json::to_string(&now)?)?;
        }
        Ok(())
    }

    /// With a relay, only the relay address is announced: it is stable, and it keeps the
    /// addresses of a home network out of public claims. Without one, the local addresses are
    /// all there is.
    async fn files_addr(&self) -> EndpointAddr {
        let endpoint = self.files.endpoint();
        if self.config.relays.is_empty() {
            for _ in 0..30 {
                if endpoint.addr().ip_addrs().next().is_some() {
                    break;
                }
                sleep(Duration::from_millis(100)).await;
            }
            endpoint.addr()
        } else {
            let _ = timeout(Duration::from_secs(10), endpoint.online()).await;
            let addr = endpoint.addr();
            EndpointAddr::from_parts(addr.id, addr.addrs.into_iter().filter(|a| a.is_relay()))
        }
    }
}

/// Moves every claim p2panda delivers into the index, then tells p2panda it is done with it.
/// A claim that was not acknowledged is delivered again after a restart.
async fn consume(mut subscription: StreamSubscription<Claim>, index: Index, ended: watch::Sender<u64>) {
    while let Some(event) = subscription.next().await {
        match event {
            StreamEvent::Processed { operation, .. } => {
                let id = operation.id().to_hex();
                let author = operation.author().to_hex();
                match index
                    .insert(&id, &author, operation.timestamp(), operation.message())
                    .await
                {
                    Ok(_) => {
                        if let Err(err) = operation.ack().await {
                            eprintln!("delphi-p2p: could not acknowledge claim {id}: {err}");
                        }
                    }
                    Err(err) => eprintln!("delphi-p2p: could not index claim {id}: {err}"),
                }
            }
            StreamEvent::SyncEnded { .. } => ended.send_modify(|n| *n += 1),
            _ => {}
        }
    }
}

/// Runs a download to its end. A transfer that moves is left to finish however long it takes; one
/// that brings nothing for a minute is dropped, and what it brought stays in the store.
async fn transfer(download: DownloadProgress) -> Result<()> {
    let mut items = download.stream().await.map_err(|err| anyhow::anyhow!("{err}"))?;
    loop {
        match timeout(STALLED, items.next()).await {
            Ok(Some(DownloadProgressItem::Error(err))) => bail!("{err}"),
            Ok(Some(DownloadProgressItem::DownloadError)) => bail!("no client that holds it could send it"),
            Ok(Some(_)) => {}
            Ok(None) => return Ok(()),
            Err(_) => bail!("the transfer stalled"),
        }
    }
}
