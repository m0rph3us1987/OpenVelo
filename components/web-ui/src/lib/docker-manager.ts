import Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';

// ── Dockerode client (used on Linux or when DOCKER_HOST is set) ──────────────

function createDockerClient(): Docker {
  const dockerHost = process.env.DOCKER_HOST;

  if (dockerHost) {
    if (dockerHost.startsWith('tcp://')) {
      const url = new URL(dockerHost);
      return new Docker({ host: url.hostname, port: parseInt(url.port || '2375', 10) });
    }
    if (dockerHost.startsWith('unix://')) {
      return new Docker({ socketPath: dockerHost.replace(/^unix:\/\//, '') });
    }
    if (dockerHost.startsWith('npipe://')) {
      return new Docker({ socketPath: dockerHost.replace(/^npipe:\/\//, '') });
    }
    return new Docker({ socketPath: dockerHost });
  }

  if (process.platform === 'win32') {
    return new Docker({ socketPath: '//./pipe/docker_engine' });
  }

  const socketPath = fs.existsSync('/home/' + (process.env.USER || process.env.LOGNAME || 'root') + '/.docker/desktop/docker.sock')
    ? '/home/' + (process.env.USER || process.env.LOGNAME || 'root') + '/.docker/desktop/docker.sock'
    : '/var/run/docker.sock';
  return new Docker({ socketPath });
}

// Use Docker CLI inside Windows containers — Node.js named pipe I/O is broken (ENOTSUP).
// docker.exe uses native Windows APIs and handles the pipe correctly.
const useDockerCli = process.platform === 'win32' && process.env.OPENVELO_CONTAINER_MODE === 'true';

// When running inside a container, resolve the network we are on
// so child containers can be attached to the same network for direct communication.
let _resolvedNetworkMode: string | null = null;
async function resolveNetworkMode(docker: Docker): Promise<string | null> {
  if (_resolvedNetworkMode !== null) return _resolvedNetworkMode;
  if (process.env.OPENVELO_CONTAINER_MODE !== 'true') return null;

  try {
    const hostname = process.env.HOSTNAME;
    if (!hostname) return null;
    const container = docker.getContainer(hostname);
    const info = await container.inspect();
    const networks = info.NetworkSettings.Networks;
    if (networks) {
      const keys = Object.keys(networks);
      if (keys.length > 0) {
        _resolvedNetworkMode = keys[0];
        console.log(`[docker-manager] Resolved container network: ${_resolvedNetworkMode}`);
        return _resolvedNetworkMode;
      }
    }
  } catch (err) {
    console.warn('[docker-manager] Failed to resolve container network. Falling back to default bridge.', (err as Error).message);
  }
  return null;
}

function resolveCliNetworkMode(): string | null {
  if (process.env.OPENVELO_CONTAINER_MODE !== 'true') return null;
  try {
    const hostname = (process.env.COMPUTERNAME || execSync('hostname', { encoding: 'utf-8' }).trim()).toLowerCase();
    const inspectJson = execSync(`docker inspect ${hostname}`, { encoding: 'utf-8', timeout: 10000 });
    const info = JSON.parse(inspectJson);
    const networks = info[0]?.NetworkSettings?.Networks;
    if (networks) {
      const keys = Object.keys(networks);
      if (keys.length > 0) return keys[0];
    }
  } catch { /* ignore */ }
  return null;
}

// When running inside a container, resolve the host path of our data volume
// so child containers get proper absolute host paths for their bind mounts.
let _resolvedHostDataPath: string | null = null;
function resolveHostDataPath(): string | null {
  if (_resolvedHostDataPath !== undefined && _resolvedHostDataPath !== null) return _resolvedHostDataPath;
  if (!useDockerCli) return null;
  try {
    // Ask Docker for our own container's mounts — find the one targeting the data dir
    const hostname = (process.env.COMPUTERNAME || execSync('hostname', { encoding: 'utf-8' }).trim()).toLowerCase();
    console.log(`[docker-manager] Self-inspecting container: ${hostname}`);
    const inspectJson = execSync(`docker inspect ${hostname}`, { encoding: 'utf-8', timeout: 10000 });
    const info = JSON.parse(inspectJson);
    const mounts: Array<{ Source: string; Destination: string }> = info[0]?.Mounts ?? [];
    // Find the mount whose Destination matches our data path (e.g. C:\openvelo\data or /openvelo/data)
    const dataMount = mounts.find((m) =>
      m.Destination.replace(/\\/g, '/').toLowerCase().includes('/openvelo/data')
    );
    if (dataMount) {
      _resolvedHostDataPath = dataMount.Source;
      console.log(`[docker-manager] Resolved host data path: ${_resolvedHostDataPath}`);
      return _resolvedHostDataPath;
    }
  } catch (err) {
    console.error('[docker-manager] Failed to resolve host data path:', err);
  }
  _resolvedHostDataPath = null;
  return null;
}

export const dockerManager = {
  async spawnOrchestratorContainer(
    projectId: number,
    _projectPort: number,
    envVars: Record<string, string>
  ): Promise<{ containerId: string }> {
    const orchImage = process.env.ORCHESTRATOR_IMAGE || 'openvelo-orchestrator:linux';
    console.log(`[docker-manager] spawnOrchestratorContainer called, image=${orchImage}`);

    // On Linux, resolve relative paths to absolute — Docker requires absolute paths for bind mounts
    const rawHostPath = envVars.OPENVELO_TEMP_DATA_HOST_PATH || '';
    const tempDataHostPath = (process.platform !== 'win32' && rawHostPath && !path.isAbsolute(rawHostPath))
      ? path.resolve(rawHostPath)
      : rawHostPath;

    const env: Record<string, string> = {
      PROJECT_ID: String(projectId),
      OPENVELO_CONTAINER_MODE: 'true',
      OPENVELO_TEMP_DATA_PATH: '/openvelo/temp_data',
      ...envVars,
    };

    if (useDockerCli) {
      console.log('[docker-manager] Using Docker CLI path (Windows)');
      return spawnViaCli(orchImage, projectId, env, tempDataHostPath);
    }

    // ── Dockerode path (Linux / dev) ──────────────────────────────────────
    console.log('[docker-manager] Creating Docker client...');
    const docker = createDockerClient();
    console.log('[docker-manager] Docker client created');

    const toDockerPath = (p: string) => process.platform === 'win32' ? p.replace(/\\/g, '/') : p;
    const usingTcp = !!process.env.DOCKER_HOST?.startsWith('tcp://');

    const binds: string[] = [];
    if (!usingTcp) {
      const dockerSocketBind = process.platform === 'win32'
        ? '\\\\.\\pipe\\docker_engine:\\\\.\\pipe\\docker_engine'
        : '/var/run/docker.sock:/var/run/docker.sock';
      binds.push(dockerSocketBind);
    }
    if (tempDataHostPath) {
      binds.push(`${toDockerPath(tempDataHostPath)}:/openvelo/temp_data`);
    }
    // OpenCode credentials from host — read/write (allows containers to access and store auth)
    const homeDir = process.env.OPENVELO_HOST_HOME || process.env.HOME || (process.platform === 'win32' ? 'C:\\Users\\Administrator' : '/root');
    binds.push(`${homeDir}/.local/share/opencode/auth.json:/root/.local/share/opencode/auth.json:rw`);
    binds.push(`${homeDir}/.config/opencode:/root/.config/opencode:rw`);

    const envList = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    if (process.env.DOCKER_HOST) {
      envList.push(`DOCKER_HOST=${process.env.DOCKER_HOST}`);
    }

    const networkMode = await resolveNetworkMode(docker);

    console.log('[docker-manager] Creating container with image:', orchImage);
    console.log('[docker-manager] Container config:', {
      name: `openvelo-orchestrator-${projectId}-${Date.now()}`,
      binds: binds,
      envCount: envList.length,
      networkMode: networkMode || 'default',
    });

    const containerConfig: Docker.ContainerCreateOptions = {
      Image: orchImage,
      name: `openvelo-orchestrator-${projectId}-${Date.now()}`,
      Env: envList,
      HostConfig: {
        AutoRemove: true,
        Binds: binds,
        ExtraHosts: process.platform !== 'win32' ? ['host.docker.internal:host-gateway'] : [],
      },
    };

    if (networkMode && containerConfig.HostConfig) {
      containerConfig.HostConfig.NetworkMode = networkMode;
    }

    try {
      console.log('[docker-manager] Calling docker.createContainer()...');
      const container = await docker.createContainer(containerConfig);
      console.log('[docker-manager] Container created successfully, id:', container.id);

      console.log('[docker-manager] Calling container.start()...');
      await container.start();
      console.log('[docker-manager] Container started successfully');

      return { containerId: container.id };
    } catch (err) {
      console.error('[docker-manager] Error creating/starting container:', err);
      console.error('[docker-manager] Docker error details:', {
        message: (err as Error).message,
        stack: (err as Error).stack,
      });
      throw err;
    }
  },

  async stopOrchestratorContainer(containerId: string): Promise<void> {
    if (useDockerCli) {
      try { execSync(`docker stop ${containerId}`, { stdio: 'ignore', timeout: 30000 }); } catch { /* already stopped */ }
      return;
    }
    const docker = createDockerClient();
    try {
      await docker.getContainer(containerId).stop();
    } catch { /* already stopped */ }
  },
};

// ── Docker CLI implementation for Windows containers ──────────────────────────

function spawnViaCli(
  image: string,
  projectId: number,
  env: Record<string, string>,
  tempDataHostPath: string
): { containerId: string } {
  const containerName = `openvelo-orchestrator-${projectId}-${Date.now()}`;
  const isWindowsImage = image.includes('windows');
  const tempDataTarget = isWindowsImage ? 'C:\\openvelo\\temp_data' : '/openvelo/temp_data';

  const args: string[] = ['run', '-d', '--name', containerName];

  // Named pipe passthrough (works from docker.exe, not from Node.js net)
  args.push('-v', '\\\\.\\pipe\\docker_engine:\\\\.\\pipe\\docker_engine');

  // Resolve the host path for temp_data — prefer self-inspected host mount, fall back to env var
  let hostPath = tempDataHostPath;
  const resolvedBase = resolveHostDataPath();
  if (resolvedBase) {
    const sep = resolvedBase.includes('\\') ? '\\' : '/';
    hostPath = `${resolvedBase}${sep}temp_data`;
  }
  if (hostPath && /^[A-Z]:[\\/]/i.test(hostPath)) {
    args.push('-v', `${hostPath}:${tempDataTarget}`);
  }

  // OpenCode credentials from host — read/write (allows containers to access and store auth)
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Administrator';
    args.push('-v', `${userProfile}\\.local\\share\\opencode\\auth.json:C:\\Users\\ContainerAdministrator\\.local\\share\\opencode\\auth.json:rw`);
    args.push('-v', `${userProfile}\\.config\\opencode:C:\\Users\\ContainerAdministrator\\.config\\opencode:rw`);
  } else {
    const homeDir = process.env.HOME || '/root';
    args.push('-v', `${homeDir}/.local/share/opencode/auth.json:/root/.local/share/opencode/auth.json:rw`);
    args.push('-v', `${homeDir}/.config/opencode:/root/.config/opencode:rw`);
  }

  // Override the in-container temp data path for the orchestrator
  env.OPENVELO_TEMP_DATA_PATH = tempDataTarget;
  // Pass the resolved absolute host path so the orchestrator can use it for agent bind mounts
  if (hostPath && /^[A-Z]:[\\/]/i.test(hostPath)) {
    env.OPENVELO_TEMP_DATA_HOST_PATH = hostPath;
  }

  const networkMode = resolveCliNetworkMode();
  if (networkMode) {
    args.push('--network', networkMode);
  }

  for (const [k, v] of Object.entries(env)) {
    args.push('-e', `${k}=${v}`);
  }

  args.push(image);

  const cmdStr = `docker ${args.join(' ')}`;
  console.log(`[docker-manager] CLI spawn: ${cmdStr}`);
  const child = spawnSync('docker', args, { encoding: 'utf-8', timeout: 60000 });
  if (child.error) throw child.error;
  const output = child.stdout.trim();
  return { containerId: output };
}
