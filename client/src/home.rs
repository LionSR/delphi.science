//! The client's directory on disk: its keys, its settings, and where the stores live.

use std::fs;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

/// Another client to start discovery from, and the relay it can be reached through.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Bootstrap {
    /// The other client's public key, in hex.
    pub node: String,
    pub relay: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Config {
    /// Relays this client connects through. With none, it only reaches clients on the local
    /// network.
    #[serde(default)]
    pub relays: Vec<String>,
    #[serde(default)]
    pub bootstrap: Vec<Bootstrap>,
    /// Written into claims as the agent that made them, unless a command names another.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    /// Find other clients on the local network.
    #[serde(default = "yes")]
    pub mdns: bool,
}

fn yes() -> bool {
    true
}

/// The two secrets of a client. Both stay in `keys.json`, readable by the owner only.
#[derive(Serialize, Deserialize)]
pub struct Keys {
    /// Signs claims and identifies the client to other clients.
    pub claims: p2panda::Credentials,
    /// Identifies the separate connection that carries files, in hex.
    pub blobs: String,
}

impl Keys {
    fn generate() -> Self {
        let blobs = iroh::SecretKey::generate().to_bytes();
        Keys {
            claims: p2panda::Credentials::generate(),
            blobs: blobs.iter().map(|b| format!("{b:02x}")).collect(),
        }
    }

    pub fn blobs_key(&self) -> Result<iroh::SecretKey> {
        let mut bytes = [0u8; 32];
        if self.blobs.len() != 64 {
            bail!("keys.json: the file key is not 32 bytes of hex");
        }
        for (i, byte) in bytes.iter_mut().enumerate() {
            *byte =
                u8::from_str_radix(&self.blobs[2 * i..2 * i + 2], 16).context("keys.json: the file key is not hex")?;
        }
        Ok(iroh::SecretKey::from_bytes(&bytes))
    }
}

/// Below the smallest `sun_path` among the systems this runs on (104 bytes on macOS).
const SOCKET_PATH_LIMIT: usize = 100;

#[derive(Clone, Debug)]
pub struct Home {
    pub dir: PathBuf,
}

impl Home {
    /// `--home`, then `$DELPHI_P2P_HOME`, then `~/.delphi/p2p`.
    pub fn locate(flag: Option<PathBuf>) -> Result<Self> {
        let dir = match flag.or_else(|| std::env::var_os("DELPHI_P2P_HOME").map(PathBuf::from)) {
            Some(dir) => dir,
            None => PathBuf::from(std::env::var_os("HOME").context("HOME is not set")?).join(".delphi/p2p"),
        };
        Ok(Home {
            dir: std::path::absolute(dir)?,
        })
    }

    pub fn exists(&self) -> bool {
        self.dir.join("keys.json").exists()
    }

    /// Creates the directory and its keys. An existing home keeps its keys.
    pub fn init(&self, config: &Config) -> Result<()> {
        fs::create_dir_all(&self.dir)?;
        // The directory holds the keys and the control socket: the owner's only.
        fs::set_permissions(&self.dir, fs::Permissions::from_mode(0o700))?;
        if !self.exists() {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(self.dir.join("keys.json"))?;
            file.write_all(serde_json::to_string_pretty(&Keys::generate())?.as_bytes())?;
        }
        self.write_config(config)
    }

    pub fn keys(&self) -> Result<Keys> {
        let path = self.dir.join("keys.json");
        let text = fs::read_to_string(&path)
            .with_context(|| format!("no client at {}: run `delphi-p2p init` first", self.dir.display()))?;
        Ok(serde_json::from_str(&text)?)
    }

    pub fn config(&self) -> Result<Config> {
        let path = self.dir.join("config.json");
        match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).with_context(|| format!("{}", path.display())),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
            Err(err) => Err(err.into()),
        }
    }

    pub fn write_config(&self, config: &Config) -> Result<()> {
        fs::write(
            self.dir.join("config.json"),
            serde_json::to_string_pretty(config)? + "\n",
        )?;
        Ok(())
    }

    /// Takes the directory for this process: its stores can be open in one process only. The
    /// lock goes when the returned file is dropped or the process ends. `None` when another
    /// process holds it.
    pub fn lock(&self) -> Result<Option<fs::File>> {
        let file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.join("lock"))?;
        match file.try_lock() {
            Ok(()) => Ok(Some(file)),
            Err(fs::TryLockError::WouldBlock) => Ok(None),
            Err(fs::TryLockError::Error(err)) => Err(err.into()),
        }
    }

    pub fn claims_db(&self) -> PathBuf {
        self.dir.join("claims.sqlite")
    }

    pub fn index_db(&self) -> PathBuf {
        self.dir.join("index.sqlite")
    }

    pub fn blobs(&self) -> PathBuf {
        self.dir.join("blobs")
    }

    /// Where `check` puts the files of a snapshot before judging them.
    pub fn work(&self, snapshot: &str) -> PathBuf {
        self.dir.join("work").join(snapshot)
    }

    /// The control socket of a running client. A Unix socket's path is limited to about a hundred
    /// bytes, so a client in a deep directory keeps its socket in the user's runtime directory,
    /// under a name derived from its own path.
    pub fn socket(&self) -> PathBuf {
        let inside = self.dir.join("control.sock");
        if inside.as_os_str().len() <= SOCKET_PATH_LIMIT {
            return inside;
        }
        let runtime = ["XDG_RUNTIME_DIR", "TMPDIR"]
            .iter()
            .find_map(std::env::var_os)
            .map_or_else(std::env::temp_dir, PathBuf::from);
        let name = p2panda::Hash::digest(self.dir.as_os_str().as_encoded_bytes()).to_hex();
        runtime.join(format!("delphi-p2p-{}.sock", &name[..16]))
    }

    /// The file address this client last announced, so that it announces again only on a change.
    pub fn announced(&self) -> PathBuf {
        self.dir.join("announced.json")
    }
}

/// What a directory fetched with `get`, or published from, remembers about where it came from.
/// A later `publish` in it follows that version without being told.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Origin {
    /// The publish claim these files are a copy of.
    pub version: String,
    pub snapshot: String,
}

impl Origin {
    fn path(dir: &Path) -> PathBuf {
        dir.join(".delphi/origin.json")
    }

    pub fn read(dir: &Path) -> Option<Self> {
        serde_json::from_str(&fs::read_to_string(Self::path(dir)).ok()?).ok()
    }

    pub fn write(&self, dir: &Path) -> Result<()> {
        fs::create_dir_all(dir.join(".delphi"))?;
        fs::write(Self::path(dir), serde_json::to_string_pretty(self)? + "\n")?;
        Ok(())
    }
}
