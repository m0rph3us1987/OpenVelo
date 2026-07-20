FROM node:20-bookworm

# Upgrade npm
RUN npm install -g npm@10

# Set root user explicitly
USER root

# Install system dependencies & build tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    golang \
    libicu-dev \
    fuse3 \
    && rm -rf /var/lib/apt/lists/*

# Install .NET 10 SDK
RUN wget https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O packages-microsoft-prod.deb \
    && dpkg -i packages-microsoft-prod.deb \
    && rm packages-microsoft-prod.deb \
    && apt-get update && apt-get install -y dotnet-sdk-10.0 \
    && rm -rf /var/lib/apt/lists/*

# Set up work directory
WORKDIR /app

# Install AI CLI tools (provides `kilo acp` for the in-process bridge)
# Pinned to 7.3.45: the agent's ACP plan/todo handling (acp-client.ts)
# depends on this version's session-update behavior.
RUN npm install -g @kilocode/cli@7.3.45 \
 	&& npm install typescript

# Set global Git configuration
RUN git config --global user.email "openvelo-agent@openvelo.org" && \
    git config --global user.name "OpenVelo Agent"

# Copy package.json and install wrapper dependencies
COPY package*.json ./
RUN npm install

# Ship the gbfs binary at /gbfs/gbfs (staged by scripts/stage-gbfs.mjs).
COPY gbfs-binary /gbfs/gbfs
RUN chmod +x /gbfs/gbfs \
    && ln -s /gbfs/gbfs /usr/local/bin/gbfs

# Copy wrapper source and configuration
COPY . .

# Compile TypeScript
RUN npx tsc

# Create data directories
RUN mkdir /repo /story && chmod 777 /repo /story /root
RUN mkdir -p /root/.local/share/kilo /root/.config/kilo

# Set Environment Variables
ENV NODE_ENV=development
ENV PATH="/app/node_modules/.bin:/usr/local/lib/node_modules/.bin:${PATH}"
ENV CI=true

# Define the entrypoint
CMD ["node", "dist/index.js"]
