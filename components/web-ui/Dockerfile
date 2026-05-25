FROM node:20-bookworm-slim

WORKDIR /app

# Upgrade npm
RUN npm install -g npm@latest

# Build tools needed for native modules (better-sqlite3, node-pty)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    curl \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# ── AI CLI tools ──────────────────────────────────────────────────────────────
# Install all CLIs in one layer — same packages as the agent image
RUN npm install -g \
    'opencode-ai@1.14.25'

COPY package*.json ./
COPY .npmrc* ./
RUN npm ci

COPY . .

# Build Vite SPA
RUN npm run build

# Create opencode config directories
RUN mkdir -p /root/.local/share/opencode /root/.config/opencode

ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--enable-source-maps"

EXPOSE 3000

CMD ["node_modules/.bin/tsx", "server.ts"]
