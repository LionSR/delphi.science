//! What a claim carries.
//!
//! A claim is the body of one p2panda operation. The header is p2panda's: it holds the author's
//! key, the signature and the time. The body is ours: a kind, the claims it refers to, and the
//! fields of that kind.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The body of every claim, whatever its kind.
///
/// `data` stays untyped here so that a client still stores and forwards kinds it does not know.
/// Code reads it through [`Claim::read`], which gives the typed fields of one kind.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Claim {
    pub kind: String,
    /// The agent that wrote this for its owner, for example "Claude Code".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    /// Ids of the claims this one refers to.
    #[serde(default)]
    pub refs: Vec<String>,
    pub data: Value,
}

/// The typed fields of one kind of claim.
pub trait Kind: Serialize + DeserializeOwned {
    const NAME: &'static str;
}

impl Claim {
    pub fn new<K: Kind>(body: &K, refs: Vec<String>, agent: Option<String>) -> Self {
        Claim {
            kind: K::NAME.to_string(),
            agent,
            refs,
            data: serde_json::to_value(body).expect("claim fields serialise to JSON"),
        }
    }

    /// The fields of kind `K`, or `None` when this claim is of another kind or malformed.
    pub fn read<K: Kind>(&self) -> Option<K> {
        if self.kind != K::NAME {
            return None;
        }
        serde_json::from_value(self.data.clone()).ok()
    }
}

/// One version of a research artifact. `refs` names the version it follows; the first has none.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Publish {
    pub title: String,
    #[serde(default)]
    pub authors: Vec<String>,
    /// Where it came from, for example the paper's URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// What changed in this version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// BLAKE3 of the file snapshot: an iroh-blobs collection, which lists every path and its hash.
    pub snapshot: String,
    pub files: u64,
    pub bytes: u64,
    /// For a Lean project that is judged against a challenge: the path, inside the snapshot, of
    /// the configuration `lake comparator` reads. Without one the whole project goes through
    /// `lake check`. Many records can share one snapshot and differ in this path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparator: Option<String>,
}

impl Kind for Publish {
    const NAME: &'static str = "publish";
}

/// "I hold the files of this snapshot." `refs` names the publish claim.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Have {
    pub snapshot: String,
}

impl Kind for Have {
    const NAME: &'static str = "have";
}

/// Where the author's file endpoint can be reached. The newest one by an author counts.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Endpoint {
    pub blobs: iroh::EndpointAddr,
    /// Whether the client stays up. Other clients start their search for peers from the ones
    /// that do, so the network needs no fixed machine to find itself.
    #[serde(default)]
    pub serving: bool,
}

impl Kind for Endpoint {
    const NAME: &'static str = "endpoint";
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    /// The checker accepted the snapshot.
    Pass,
    /// The checker ran and rejected it.
    Fail,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Pass => "pass",
            Verdict::Fail => "fail",
        }
    }
}

/// The result of re-running a checker on one snapshot. `refs` names the publish claim.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Check {
    /// The snapshot that was checked. A check says nothing about any other version.
    pub snapshot: String,
    /// The command that judged it: "lake check" or "lake comparator".
    pub checker: String,
    /// The Lean toolchain named by the project, for example "leanprover/lean4:v4.36.0".
    pub toolchain: String,
    /// How the untrusted project was confined: "bwrap", "docker+bwrap" or "none".
    pub runner: String,
    pub result: Verdict,
    pub exit_code: i32,
    /// The end of the checker's output, kept short.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Kind for Check {
    const NAME: &'static str = "check";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_claim_reads_back_as_its_own_kind_only() {
        let have = Have {
            snapshot: "ab".repeat(32),
        };
        let claim = Claim::new(&have, vec!["cd".repeat(32)], Some("Claude Code".into()));
        assert_eq!(claim.kind, "have");
        assert_eq!(claim.read::<Have>(), Some(have));
        assert_eq!(claim.read::<Publish>(), None);
    }

    #[test]
    fn an_unknown_kind_still_decodes() {
        let claim: Claim = serde_json::from_str(r#"{"kind":"vote","refs":["00"],"data":{"value":1}}"#).unwrap();
        assert_eq!(claim.kind, "vote");
        assert_eq!(claim.read::<Have>(), None);
    }
}
