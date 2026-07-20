FROM node:20-bookworm-slim

WORKDIR /app

# Upgrade npm
RUN npm install -g npm@10

# Build tools needed for native modules (better-sqlite3, node-pty)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    curl \
    fuse3 \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# ── AI CLI tools ──────────────────────────────────────────────────────────────
# Install all CLIs in one layer — same packages as the agent image.
# Pinned to 7.3.45 to stay compatible with the agent's ACP plan/todo handling.
RUN npm install -g \
    @kilocode/cli@7.3.45

COPY package*.json ./
COPY .npmrc* ./
RUN npm ci

# Ship the gbfs binary at /gbfs/gbfs (staged by scripts/stage-gbfs.mjs).
COPY gbfs-binary /gbfs/gbfs
RUN chmod +x /gbfs/gbfs \
    && ln -s /gbfs/gbfs /usr/local/bin/gbfs

COPY . .

# Build Vite SPA
RUN npm run build

# Create kilo config directories
RUN mkdir -p /root/.local/share/kilo /root/.config/kilo

ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--enable-source-maps"

EXPOSE 3000

CMD ["node_modules/.bin/tsx", "server.ts"]
