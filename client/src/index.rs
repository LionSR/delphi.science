//! The local index: every claim this client has seen, in a table it can query.
//!
//! p2panda keeps the signed operations. This keeps what the commands ask about: a claim by id,
//! the claims that refer to another, and the order in which they arrived here.

use std::path::Path;

use anyhow::{Context, Result, bail};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use tokio::sync::watch;

use crate::claim::{Claim, Have, Kind, Publish};

/// A claim as it sits in the index.
#[derive(Clone, Debug)]
pub struct Stored {
    /// Its place in the order of arrival at this client. `log --since` continues from one.
    pub seq: i64,
    /// The id of the p2panda operation, in hex.
    pub id: String,
    /// The public key that signed it, in hex.
    pub author: String,
    /// When the author wrote it, in microseconds since 1970. The author's clock says so.
    pub at: u64,
    pub claim: Claim,
}

#[derive(Clone)]
pub struct Index {
    pool: SqlitePool,
    arrivals: watch::Sender<u64>,
}

impl Index {
    pub async fn open(path: &Path) -> Result<Self> {
        let options = SqliteConnectOptions::new().filename(path).create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;
        for statement in [
            "CREATE TABLE IF NOT EXISTS claims (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                id TEXT NOT NULL UNIQUE,
                author TEXT NOT NULL,
                at INTEGER NOT NULL,
                kind TEXT NOT NULL,
                snapshot TEXT,
                body TEXT NOT NULL
            )",
            "CREATE TABLE IF NOT EXISTS refs (
                claim TEXT NOT NULL,
                target TEXT NOT NULL,
                PRIMARY KEY (claim, target)
            )",
            "CREATE INDEX IF NOT EXISTS refs_by_target ON refs (target)",
            "CREATE INDEX IF NOT EXISTS claims_by_kind ON claims (kind, author, at)",
            "CREATE INDEX IF NOT EXISTS claims_by_snapshot ON claims (snapshot, kind)",
        ] {
            sqlx::query(statement).execute(&pool).await?;
        }
        Ok(Index {
            pool,
            arrivals: watch::channel(0).0,
        })
    }

    /// Stores a claim. Returns false when it was already here.
    pub async fn insert(&self, id: &str, author: &str, at: u64, claim: &Claim) -> Result<bool> {
        let snapshot = claim.data.get("snapshot").and_then(|v| v.as_str());
        let mut tx = self.pool.begin().await?;
        let done = sqlx::query(
            "INSERT OR IGNORE INTO claims (id, author, at, kind, snapshot, body) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(author)
        .bind(at as i64)
        .bind(&claim.kind)
        .bind(snapshot)
        .bind(serde_json::to_string(claim)?)
        .execute(&mut *tx)
        .await?;
        let new = done.rows_affected() == 1;
        if new {
            for target in &claim.refs {
                sqlx::query("INSERT OR IGNORE INTO refs (claim, target) VALUES (?, ?)")
                    .bind(id)
                    .bind(target)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        tx.commit().await?;
        if new {
            self.arrivals.send_modify(|n| *n += 1);
        }
        Ok(new)
    }

    /// Changes whenever a claim arrives. Commands that wait for one watch this.
    pub fn arrivals(&self) -> watch::Receiver<u64> {
        self.arrivals.subscribe()
    }

    /// The claim with this id, or with this unique beginning of an id.
    pub async fn get(&self, id: &str) -> Result<Option<Stored>> {
        if id.is_empty() || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            bail!("not a claim id: {id}");
        }
        let rows = sqlx::query("SELECT seq, id, author, at, body FROM claims WHERE id LIKE ? LIMIT 2")
            .bind(format!("{}%", id.to_ascii_lowercase()))
            .fetch_all(&self.pool)
            .await?;
        match rows.len() {
            0 => Ok(None),
            1 => Ok(Some(stored(&rows[0])?)),
            _ => bail!("more than one claim starts with {id}"),
        }
    }

    /// Claims that arrived after `seq`, oldest first.
    pub async fn since(&self, seq: i64, kind: Option<&str>, limit: i64) -> Result<Vec<Stored>> {
        let rows = sqlx::query(
            "SELECT seq, id, author, at, body FROM claims
             WHERE seq > ? AND (? IS NULL OR kind = ?) ORDER BY seq LIMIT ?",
        )
        .bind(seq)
        .bind(kind)
        .bind(kind)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(stored).collect()
    }

    /// Claims of kind `K` that refer to `target`, oldest first.
    pub async fn referring<K: Kind>(&self, target: &str) -> Result<Vec<Stored>> {
        let rows = sqlx::query(
            "SELECT c.seq, c.id, c.author, c.at, c.body FROM claims c
             JOIN refs r ON r.claim = c.id WHERE r.target = ? AND c.kind = ? ORDER BY c.at, c.id",
        )
        .bind(target)
        .bind(K::NAME)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(stored).collect()
    }

    /// The newest claim of kind `K` by `author`.
    pub async fn latest_by<K: Kind>(&self, author: &str) -> Result<Option<Stored>> {
        let row = sqlx::query(
            "SELECT seq, id, author, at, body FROM claims
             WHERE kind = ? AND author = ? ORDER BY at DESC, seq DESC LIMIT 1",
        )
        .bind(K::NAME)
        .bind(author)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(stored).transpose()
    }

    /// Each author's newest claim of kind `K`, the most recent authors first.
    pub async fn latest_of_each<K: Kind>(&self, limit: i64) -> Result<Vec<Stored>> {
        let rows = sqlx::query(
            "SELECT seq, id, author, at, body FROM claims c
             WHERE kind = ? AND NOT EXISTS (
                 SELECT 1 FROM claims newer WHERE newer.kind = c.kind AND newer.author = c.author
                 AND (newer.at > c.at OR (newer.at = c.at AND newer.seq > c.seq)))
             ORDER BY at DESC LIMIT ?",
        )
        .bind(K::NAME)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(stored).collect()
    }

    /// The keys that say they hold this snapshot.
    pub async fn holders(&self, snapshot: &str) -> Result<Vec<String>> {
        let rows = sqlx::query("SELECT DISTINCT author FROM claims WHERE snapshot = ? AND kind = ?")
            .bind(snapshot)
            .bind(Have::NAME)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.iter().map(|row| row.get::<String, _>(0)).collect())
    }

    /// Every publish claim, oldest first.
    pub async fn publishes(&self) -> Result<Vec<Stored>> {
        let rows = sqlx::query("SELECT seq, id, author, at, body FROM claims WHERE kind = ? ORDER BY seq")
            .bind(Publish::NAME)
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(stored).collect()
    }

    pub async fn count(&self) -> Result<i64> {
        Ok(sqlx::query("SELECT count(*) FROM claims")
            .fetch_one(&self.pool)
            .await?
            .get(0))
    }
}

/// Reads a row selected as `seq, id, author, at, body`.
fn stored(row: &sqlx::sqlite::SqliteRow) -> Result<Stored> {
    let body: String = row.get(4);
    Ok(Stored {
        seq: row.get(0),
        id: row.get(1),
        author: row.get(2),
        at: row.get::<i64, _>(3) as u64,
        claim: serde_json::from_str(&body).context("a stored claim does not parse")?,
    })
}
