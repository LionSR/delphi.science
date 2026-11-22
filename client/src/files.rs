//! Snapshots: a directory as one hash.
//!
//! A snapshot is an iroh-blobs collection. It lists every file's path and BLAKE3 hash, and its
//! own hash names the whole directory at that moment. Two snapshots that share a file share its
//! bytes in the store and on the wire.

use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, bail};
use iroh_blobs::api::Store;
use iroh_blobs::api::blobs::{AddPathOptions, ImportMode};
use iroh_blobs::format::collection::Collection;
use iroh_blobs::protocol::{ChunkRanges, ChunkRangesExt, ChunkRangesSeq, GetRequest};
use iroh_blobs::{BlobFormat, Hash, HashAndFormat};
use serde::Serialize;

/// Directories that are never part of a snapshot: the client's own notes, version control, and
/// Lean's build output, which is large and rebuilt from the sources.
const SKIPPED: [&str; 3] = [".delphi", ".git", ".lake"];

pub struct Snapshot {
    pub hash: Hash,
    pub files: u64,
    pub bytes: u64,
}

/// Copies a directory into the store and returns its snapshot.
pub async fn import(store: &Store, dir: &Path) -> Result<Snapshot> {
    let mut paths = Vec::new();
    walk(dir, dir, &mut paths)?;
    if paths.is_empty() {
        bail!("{} has no files to publish", dir.display());
    }
    paths.sort();

    let batch = store.blobs().batch().await?;
    let mut tags = Vec::new();
    let mut collection = Collection::default();
    let mut bytes = 0;
    for name in &paths {
        let path = dir.join(name);
        bytes += std::fs::metadata(&path)?.len();
        let tag = batch
            .add_path_with_opts(AddPathOptions {
                path,
                format: BlobFormat::Raw,
                mode: ImportMode::Copy,
            })
            .temp_tag()
            .await
            .with_context(|| format!("could not store {name}"))?;
        collection.push(name.clone(), tag.hash());
        tags.push(tag);
    }
    let root = collection.store(store).await?;
    let hash = root.hash();
    // A named tag keeps the snapshot and its files from being collected as garbage.
    store
        .tags()
        .set(format!("snapshot/{hash}"), HashAndFormat::hash_seq(hash))
        .await?;
    Ok(Snapshot {
        hash,
        files: paths.len() as u64,
        bytes,
    })
}

/// Writes the files of a snapshot that is complete in the store into `dir`.
pub async fn export(store: &Store, hash: Hash, dir: &Path) -> Result<u64> {
    let collection = Collection::load(hash, store).await?;
    std::fs::create_dir_all(dir)?;
    let mut files = 0;
    for (name, file) in collection.iter() {
        let target = dir.join(checked(name)?);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        store.blobs().export(*file, std::path::absolute(&target)?).await?;
        files += 1;
    }
    Ok(files)
}

/// One file of a snapshot.
#[derive(Clone, Serialize)]
pub struct Entry {
    pub path: String,
    pub bytes: u64,
    pub hash: String,
}

/// What listing a snapshot needs from a client that holds it: the list of names and hashes in
/// full, and the last chunk of each file, which proves the file's size. The files themselves
/// stay where they are, except those of up to 1024 bytes, which are one chunk.
pub fn listing(hash: Hash) -> GetRequest {
    let ranges = [ChunkRanges::all(), ChunkRanges::all(), ChunkRanges::last_chunk()];
    GetRequest::new(hash, ChunkRangesSeq::from_ranges_infinite(ranges))
}

/// The files of a snapshot, or `None` while the list or a file's size is not in the store.
pub async fn list(store: &Store, hash: Hash) -> Result<Option<Vec<Entry>>> {
    let Ok(collection) = Collection::load(hash, store).await else {
        return Ok(None);
    };
    let mut entries = Vec::new();
    for (name, file) in collection.iter() {
        let Some(bytes) = store.blobs().observe(*file).await?.validated_size() else {
            return Ok(None);
        };
        entries.push(Entry {
            path: name.clone(),
            bytes,
            hash: file.to_string(),
        });
    }
    Ok(Some(entries))
}

/// Whether every file of the snapshot is already in the store.
pub async fn complete(store: &Store, hash: Hash) -> Result<bool> {
    Ok(store.remote().local(HashAndFormat::hash_seq(hash)).await?.is_complete())
}

/// A path from somebody else's snapshot, accepted only if it stays inside the target directory.
pub fn checked(name: &str) -> Result<PathBuf> {
    let path = Path::new(name);
    let inside = !name.is_empty() && path.components().all(|part| matches!(part, Component::Normal(_)));
    if !inside {
        bail!("the snapshot names a file outside its directory: {name:?}");
    }
    Ok(path.to_path_buf())
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<()> {
    for entry in std::fs::read_dir(dir).with_context(|| format!("{}", dir.display()))? {
        let entry = entry?;
        let name = entry.file_name();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            if !SKIPPED.iter().any(|skipped| name == *skipped) {
                walk(root, &entry.path(), out)?;
            }
        } else if kind.is_file() && name != ".DS_Store" {
            let relative = entry.path().strip_prefix(root)?.to_path_buf();
            let name = relative
                .to_str()
                .context("a file name is not UTF-8")?
                .replace('\\', "/");
            out.push(name);
        }
        // Symbolic links are left out: a snapshot holds files, and a link can point anywhere.
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::checked;

    #[test]
    fn a_snapshot_cannot_write_outside_its_directory() {
        assert!(checked("Proof.lean").is_ok());
        assert!(checked("src/Proof.lean").is_ok());
        assert!(checked("../escape").is_err());
        assert!(checked("src/../../escape").is_err());
        assert!(checked("/etc/passwd").is_err());
        assert!(checked("").is_err());
    }
}
