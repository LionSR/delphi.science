//! Judging a Lean project with the checker that ships with Lean.
//!
//! `lake check` builds the project, exports it and replays it through the kernel, and rejects
//! any axiom beyond the three standard ones. `lake comparator` does the same and also compares
//! the proved statements with a challenge; it is used when the project carries a
//! `comparator.json`. Both treat the project as untrusted and confine it with bubblewrap, which
//! exists on Linux only. Elsewhere the same command runs in a Linux container.

use std::path::Path;
use std::process::Stdio;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::claim::Verdict;
use crate::files;

/// How the untrusted project is confined while it is built and checked.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Runner {
    /// bubblewrap on Linux, otherwise a container.
    #[default]
    Auto,
    /// Lake's own bubblewrap sandbox, on this machine.
    Bwrap,
    /// A Linux container, with Lake's bubblewrap sandbox inside it.
    Docker,
    /// No confinement. The project's code runs with your rights; only for projects you trust.
    None,
}

/// What the checker decided. A run that could not start is an error, not an outcome: it says
/// nothing about the project.
pub struct Outcome {
    pub checker: String,
    pub toolchain: String,
    pub runner: String,
    pub result: Verdict,
    pub exit_code: i32,
    pub detail: Option<String>,
}

/// What Lake 4.36 prints when it has judged the project and rejected it: the kernel, the
/// axioms, or the comparison with the challenge. Exit code 1 alone does not say that. A sandbox
/// that could not start and a build that ran out of memory exit with 1 as well, and neither is
/// a verdict on the proof. Lake 4.37 reports the verdict as JSON; these go when that is the
/// oldest Lean checked.
const REJECTIONS: [&str; 9] = [
    "kernel rejected the solution",
    "is not permitted; it is used by",
    "Illegal axiom detected",
    "do not match",
    "does not match",
    "don't match",
    "not found in solution",
    "not found in challenge",
    "is not a theorem",
];

/// Ubuntu's kernel setting that keeps bubblewrap from working in a container, and its remedy.
const USERNS_HINT: &str = "bubblewrap could not create its namespaces. On an Ubuntu-based Docker \
machine such as colima, allow them once with:\n  colima ssh -- sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0";

const IMAGE: &str = "delphi-lean-check:3";
/// Keeps downloaded Lean toolchains between runs.
const TOOLCHAINS: &str = "delphi-elan";
const DOCKERFILE: &str = include_str!("../docker/lean-check.Dockerfile");

/// Runs the checker on the project in `dir`.
///
/// `comparator` is the path of a comparator configuration inside the project, when the record
/// names one. `network` lets the checker reach the network while it resolves dependencies. A
/// project that depends on Mathlib needs it; the project's own code can then reach the network
/// too.
pub async fn run(dir: &Path, comparator: Option<&str>, runner: Runner, network: bool) -> Result<Outcome> {
    let toolchain = toolchain(dir)?;
    if !network && has_dependencies(dir)? {
        bail!(
            "the project depends on other packages, and fetching them needs the network: run the check again with --network"
        );
    }
    let args: Vec<&str> = match comparator {
        Some(config) => {
            // The path comes from a stranger's claim and ends up on a command line.
            files::checked(config)?;
            vec!["comparator", "--config", config]
        }
        None if dir.join("comparator.json").exists() => vec!["comparator"],
        None => vec!["check"],
    };
    let checker = format!("lake {}", args.join(" "));

    let runner = match runner {
        Runner::Auto if cfg!(target_os = "linux") && succeeds("bwrap", &["--version"]).await => Runner::Bwrap,
        Runner::Auto if succeeds("docker", &["info"]).await => Runner::Docker,
        Runner::Auto => bail!(
            "no way to confine the check: it needs bubblewrap on Linux, or a running Docker. \
             `--runner none` runs it unconfined, for a project you trust."
        ),
        chosen => chosen,
    };

    let (name, output) = match runner {
        Runner::Bwrap => ("bwrap", lake(dir, &args).await?),
        Runner::None => (
            "none",
            lake(dir, &[&args[..], &["--inadvisably-no-sandbox"]].concat()).await?,
        ),
        Runner::Docker => ("docker+bwrap", docker(dir, &args, &toolchain, network).await?),
        Runner::Auto => unreachable!("resolved above"),
    };

    let exit_code = output.status.code().unwrap_or(-1);
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    let detail = tail(&text, 800);
    let result = match exit_code {
        0 => Verdict::Pass,
        1 if REJECTIONS.iter().any(|marker| text.contains(marker)) => Verdict::Fail,
        _ => {
            let refused = text.contains("Permission denied") || text.contains("Operation not permitted");
            let hint = if text.contains("bwrap:") && refused {
                format!("\n{USERNS_HINT}")
            } else {
                String::new()
            };
            bail!(
                "{checker} did not reach a verdict (exit code {exit_code}):\n{}{hint}",
                detail.unwrap_or_default()
            )
        }
    };
    Ok(Outcome {
        checker,
        toolchain,
        runner: name.into(),
        result,
        exit_code,
        detail,
    })
}

/// Whether the project's manifest lists packages to fetch. Lake resolves them inside its
/// sandbox, from the network.
fn has_dependencies(dir: &Path) -> Result<bool> {
    let Ok(text) = std::fs::read_to_string(dir.join("lake-manifest.json")) else {
        // Lake says so itself, in words the author can act on.
        return Ok(false);
    };
    let manifest: serde_json::Value = serde_json::from_str(&text).context("lake-manifest.json is not JSON")?;
    Ok(manifest
        .get("packages")
        .and_then(|p| p.as_array())
        .is_some_and(|p| !p.is_empty()))
}

/// The toolchain the project names. It is passed to elan, so only official Lean releases pass.
fn toolchain(dir: &Path) -> Result<String> {
    let text = std::fs::read_to_string(dir.join("lean-toolchain"))
        .context("the snapshot has no lean-toolchain file, so it is not a Lean project")?;
    let name = text.trim();
    let version = name.strip_prefix("leanprover/lean4:v").unwrap_or("");
    let plain = !version.is_empty()
        && version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    if !plain {
        bail!("lean-toolchain names {name:?}; only leanprover/lean4:v… releases are checked");
    }
    Ok(name.to_string())
}

async fn lake(dir: &Path, args: &[&str]) -> Result<std::process::Output> {
    Command::new("lake")
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .output()
        .await
        .context("could not run lake")
}

async fn docker(dir: &Path, args: &[&str], toolchain: &str, network: bool) -> Result<std::process::Output> {
    if !succeeds("docker", &["image", "inspect", IMAGE]).await {
        let mut build = Command::new("docker")
            .args(["build", "-t", IMAGE, "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .context("could not run docker")?;
        build
            .stdin
            .take()
            .expect("stdin is piped")
            .write_all(DOCKERFILE.as_bytes())
            .await?;
        let built = build.wait_with_output().await?;
        if !built.status.success() {
            bail!(
                "could not build the check image:\n{}",
                String::from_utf8_lossy(&built.stderr)
            );
        }
    }

    let volume = format!("{TOOLCHAINS}:/home/checker/.elan");
    // The toolchain is fetched first, with the network on and none of the project's code running.
    let installed = Command::new("docker")
        .args([
            "run",
            "--rm",
            "-v",
            &volume,
            IMAGE,
            "elan",
            "toolchain",
            "install",
            toolchain,
        ])
        .stdin(Stdio::null())
        .output()
        .await?;
    if !installed.status.success() {
        return Ok(installed);
    }

    // The files are copied into the container, not mounted: a mount works only for the
    // directories the Docker machine happens to share with this one.
    let mut create = Command::new("docker");
    create.args(["create", "-v", &volume, "-w", "/work"]);
    // bubblewrap creates namespaces and mounts a fresh /proc. Docker's default seccomp and
    // AppArmor profiles refuse the first, and its masked /proc paths refuse the second.
    for option in ["seccomp=unconfined", "apparmor=unconfined", "systempaths=unconfined"] {
        create.args(["--security-opt", option]);
    }
    if !network {
        create.args(["--network", "none"]);
    }
    create.args([IMAGE, "lake"]).args(args);
    let created = create.stdin(Stdio::null()).output().await?;
    if !created.status.success() {
        return Ok(created);
    }
    let container = String::from_utf8_lossy(&created.stdout).trim().to_string();

    let source = format!("{}/.", dir.display());
    let copied = Command::new("docker")
        .args(["cp", &source, &format!("{container}:/work")])
        .stdin(Stdio::null())
        .output()
        .await?;
    let output = if copied.status.success() {
        Command::new("docker")
            .args(["start", "--attach", &container])
            .stdin(Stdio::null())
            .output()
            .await?
    } else {
        copied
    };
    let _ = Command::new("docker")
        .args(["rm", "--force", &container])
        .stdin(Stdio::null())
        .output()
        .await;
    Ok(output)
}

async fn succeeds(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .is_ok_and(|status| status.success())
}

/// The last `limit` characters of the checker's output, or nothing when it printed nothing.
fn tail(text: &str, limit: usize) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let start = text.char_indices().rev().nth(limit - 1).map_or(0, |(at, _)| at);
    Some(text[start..].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_official_toolchains_reach_elan() {
        let dir = std::env::temp_dir().join(format!("delphi-toolchain-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for (text, ok) in [
            ("leanprover/lean4:v4.36.0\n", true),
            ("leanprover/lean4:v4.37.0-rc1", true),
            ("https://example.org/evil", false),
            ("leanprover/lean4:v4.36.0 && rm -rf /", false),
            ("", false),
        ] {
            std::fs::write(dir.join("lean-toolchain"), text).unwrap();
            assert_eq!(toolchain(&dir).is_ok(), ok, "{text:?}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_tail_keeps_the_end() {
        assert_eq!(tail("  \n", 5), None);
        assert_eq!(tail("abcdef", 3).as_deref(), Some("def"));
        assert_eq!(tail("ab", 3).as_deref(), Some("ab"));
    }
}
