# The environment `delphi-p2p check` runs in on machines without bubblewrap, such as a Mac.
# It holds elan and bubblewrap. Lean toolchains are kept in a volume, not in the image.
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git bubblewrap \
 && rm -rf /var/lib/apt/lists/*
# Lake covers /run/user with an empty filesystem inside its sandbox, so the directory has to exist.
RUN useradd --create-home --uid 1000 checker && mkdir -p /work /run/user && chown checker /work
USER checker
RUN curl -sSf https://elan.lean-lang.org/elan-init.sh | sh -s -- -y --default-toolchain none
ENV PATH=/home/checker/.elan/bin:$PATH
