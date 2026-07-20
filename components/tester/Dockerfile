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
    xvfb \
    x11vnc \
    xdotool \
    imagemagick \
    maim \
    dbus \
    dbus-x11 \
    at-spi2-core \
    python3-pyatspi \
    python3-gi \
    gir1.2-gtk-3.0 \
    # xdg-desktop-portal(-gtk) provides the GTK file-chooser portal. Without
    # it, Avalonia (and other toolkits) fall back to an in-process "managed"
    # file/folder picker that is NOT exposed to AT-SPI — so the accessibility
    # controller (elements()) is blind to the dialog's controls. Installing
    # the portal makes the dialog a real, accessible GtkFileChooser.
    xdg-desktop-portal \
    xdg-desktop-portal-gtk \
    x11-xserver-utils \
    python3-tk \
    gnome-screenshot \
    openbox \
    libnss3 \
    libgtk-3-0 \
    libasound2 \
    libxss1 \
    libgbm1 \
    libxshmfence1 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    fuse3 \
    chromium \
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
 	&& npm install typescript \
 	&& npm install -g @playwright/mcp

# Configure Playwright to use the system Chromium and skip downloading its own
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium


# Set global Git configuration
RUN git config --global user.email "openvelo-tester@openvelo.org" && \
    git config --global user.name "OpenVelo Tester"

# Copy package.json and install wrapper dependencies
COPY package*.json ./
RUN npm install

# Ship the gbfs binary at /gbfs/gbfs (staged by scripts/stage-gbfs.mjs).
COPY gbfs-binary /gbfs/gbfs
RUN chmod +x /gbfs/gbfs \
    && ln -s /gbfs/gbfs /usr/local/bin/gbfs

# Copy wrapper source and configuration
COPY tsconfig.json ./
COPY src ./src
COPY mcp ./mcp
COPY prompts ./prompts
COPY SKILLS /SKILLS
COPY entrypoint.sh ./entrypoint.sh
COPY requirements.txt ./requirements.txt

# Compile TypeScript
RUN npx tsc

# Install python dependencies system-wide (using break-system-packages for container deployment)
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Setup helper scripts: run.sh (non-blocking GUI launcher) and
# stop.sh (non-blocking process stopper). Both keep the agent's tool
# calls from blocking on GUI app lifetime / teardown.
RUN cp mcp/run.sh /usr/local/bin/run.sh && chmod 755 /usr/local/bin/run.sh \
    && cp mcp/stop.sh /usr/local/bin/stop.sh && chmod 755 /usr/local/bin/stop.sh

# Create data directories
RUN mkdir -p /repo /tmp/verdicts /tmp/tester-shots /work/scratch/logs /work/tmp /data \
    && chmod 777 /repo /tmp/verdicts /tmp/tester-shots /work /root /data \
    && mkdir -p /root/.local/share/kilo /root/.config/kilo /root/Desktop \
    && chmod -R a+rX /SKILLS /app/mcp \
    && chmod +x /app/entrypoint.sh

# Set Environment Variables
ENV NODE_ENV=development
ENV PATH="/app/node_modules/.bin:/usr/local/lib/node_modules/.bin:${PATH}"
ENV CI=true

ENV DISPLAY=:99
ENV SCREEN_W=1280
ENV SCREEN_H=1024
ENV SCREEN_DEPTH=24
ENV PORT_VNC=5900
ENV CONTROLLER_PORT=8080
ENV TESTER_PORT=8081
ENV MCP_TRANSPORT=streamable-http
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8765
ENV VERDICTS_DIR=/tmp/verdicts

EXPOSE 8081 8080 5900 8765
CMD ["/app/entrypoint.sh"]
