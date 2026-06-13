FROM node:20-bookworm-slim

WORKDIR /app

# Upgrade npm
RUN npm install -g npm@latest

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# Create kilo config directories
RUN mkdir -p /root/.local/share/kilo /root/.config/kilo

ENV NODE_ENV=production

CMD ["node_modules/.bin/tsx", "src/index.ts"]
