import Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { execSync } from 'child_process';
import { CONFIG } from './config.js';

const imageOsCache = new Map<string, string>();

// Use Docker CLI inside Windows containers — Node.js named pipe I/O is broken (ENOTSUP).
const useDockerCli = process.platform === 'win32' && process.env.OPENVELO_CONTAINER_MODE === 'true';

let _resolvedNetworkMode: string | null = null;

export class DockerManager {
    private docker: Docker;

    constructor() {
        if (useDockerCli) {
            // Docker client won't be used, but we need a valid instance for the class shape
            this.docker = null as unknown as Docker;
            return;
        }

        const dockerHost = process.env.DOCKER_HOST;

        if (dockerHost) {
            if (dockerHost.startsWith('tcp://')) {
                const url = new URL(dockerHost);
                this.docker = new Docker({ host: url.hostname, port: parseInt(url.port || '2375', 10) });
            } else if (dockerHost.startsWith('unix://')) {
                this.docker = new Docker({ socketPath: dockerHost.replace(/^unix:\/\//, '') });
            } else if (dockerHost.startsWith('npipe://')) {
                this.docker = new Docker({ socketPath: dockerHost.replace(/^npipe:\/\//, '') });
            } else {
                this.docker = new Docker({ socketPath: dockerHost });
            }
        } else if (process.platform === 'win32') {
            this.docker = new Docker({ socketPath: '//./pipe/docker_engine' });
        } else {
            const socketPath = fs.existsSync('/home/' + (process.env.USER || process.env.LOGNAME || 'root') + '/.docker/desktop/docker.sock')
                ? '/home/' + (process.env.USER || process.env.LOGNAME || 'root') + '/.docker/desktop/docker.sock'
                : '/var/run/docker.sock';
            this.docker = new Docker({ socketPath });
        }
    }

    private async resolveNetworkMode(): Promise<string | null> {
        if (_resolvedNetworkMode !== null) return _resolvedNetworkMode;
        if (process.env.OPENVELO_CONTAINER_MODE !== 'true') return null;
        if (useDockerCli) return this.resolveCliNetworkMode();

        try {
            const hostname = process.env.HOSTNAME;
            if (!hostname) return null;
            const container = this.docker.getContainer(hostname);
            const info = await container.inspect();
            const networks = info.NetworkSettings.Networks;
            if (networks) {
                const keys = Object.keys(networks);
                if (keys.length > 0) {
                    _resolvedNetworkMode = keys[0] ?? null;
                    console.log(`[docker] Resolved orchestrator network: ${_resolvedNetworkMode}`);
                    return _resolvedNetworkMode;
                }
            }
        } catch (err) {
            console.warn('[docker] Failed to resolve orchestrator network.', (err as Error).message);
        }
        return null;
    }

    private resolveCliNetworkMode(): string | null {
        try {
            const hostname = (process.env.COMPUTERNAME || execSync('hostname', { encoding: 'utf-8' }).trim()).toLowerCase();
            const inspectJson = execSync(`docker inspect ${hostname}`, { encoding: 'utf-8', timeout: 10000 });
            const info = JSON.parse(inspectJson);
            const networks = info[0]?.NetworkSettings?.Networks;
            if (networks) {
                const keys = Object.keys(networks);
                if (keys.length > 0) return keys[0] ?? null;
            }
        } catch { /* ignore */ }
        return null;
    }

    private async findFreePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.unref();
            server.on('error', reject);
            server.listen(0, () => {
                const address = server.address();
                if (typeof address === 'string' || !address) {
                    reject(new Error('Unexpected address type'));
                    return;
                }
                const port = address.port;
                server.close(() => resolve(port));
            });
        });
    }

    private async detectImageOs(imageName: string): Promise<string> {
        const cached = imageOsCache.get(imageName);
        if (cached) return cached;
        try {
            if (useDockerCli) {
                const output = execSync(`docker inspect --format={{.Os}} ${imageName}`, { encoding: 'utf-8', timeout: 10000 }).trim();
                imageOsCache.set(imageName, output || 'linux');
                return output || 'linux';
            }
            const image = this.docker.getImage(imageName);
            const info = await image.inspect();
            const os = info.Os || 'linux';
            imageOsCache.set(imageName, os);
            return os;
        } catch {
            return 'linux';
        }
    }

    public async spawnAgent(jobId: number): Promise<{ containerId: string, host: string, port: number }> {
        const agentHostPort = await this.findFreePort();
        const agentInternalPort = 3001;
        const containerName = `openvelo-agent-${jobId}-${Date.now()}`;

        const homeDir = process.env.OPENVELO_HOST_HOME || process.env.HOME || process.env.USERPROFILE || '/root';
        const toDockerPath = (p: string) => process.platform === 'win32' ? p.replace(/\\/g, '/') : p;

        const imageOs = await this.detectImageOs(CONFIG.DOCKER_IMAGE);
        const isWindowsContainer = imageOs === 'windows';

        const containerPath = (linuxPath: string, winPath: string) =>
            isWindowsContainer ? winPath : linuxPath;

        const binds: string[] = [];
        
        const opencodeAuthSource = path.join(homeDir, '.local', 'share', 'opencode', 'auth.json');
        const opencodeAuthTarget = containerPath('/root/.local/share/opencode/auth.json', 'C:/Users/ContainerAdministrator/.local/share/opencode/auth.json');
        const opencodeAuthCheckPath = containerPath('/root/.local/share/opencode/auth.json', 'C:/Users/ContainerAdministrator/.local/share/opencode/auth.json');

        const authSourceExists = process.env.OPENVELO_CONTAINER_MODE === 'true'
            ? fs.existsSync(opencodeAuthCheckPath)
            : fs.existsSync(opencodeAuthSource);

        if (authSourceExists) {
            binds.push(`${toDockerPath(opencodeAuthSource)}:${opencodeAuthTarget}:rw`);
        }

        const opencodeConfigSource = path.join(homeDir, '.config', 'opencode');
        const opencodeConfigTarget = containerPath('/root/.config/opencode', 'C:/Users/ContainerAdministrator/.config/opencode');
        const opencodeConfigCheckPath = containerPath('/root/.config/opencode', 'C:/Users/ContainerAdministrator/.config/opencode');

        const configSourceExists = process.env.OPENVELO_CONTAINER_MODE === 'true'
            ? fs.existsSync(opencodeConfigCheckPath)
            : fs.existsSync(opencodeConfigSource);

        if (configSourceExists) {
            binds.push(`${toDockerPath(opencodeConfigSource)}:${opencodeConfigTarget}:rw`);
        }

        const skillsHostPath = CONFIG.SKILLS_HOST_PATH;
        if (skillsHostPath) {
            const skillsTarget = containerPath('/SKILLS', 'C:/SKILLS');
            binds.push(`${toDockerPath(skillsHostPath)}:${skillsTarget}:rw`);
        }

        const networkMode = await this.resolveNetworkMode();

        console.log('[docker] Creating agent container:', {
            image: CONFIG.DOCKER_IMAGE,
            networkMode: networkMode || 'bridge',
            name: containerName
        });

        try {
            const containerConfig: any = {
                Image: CONFIG.DOCKER_IMAGE,
                name: containerName,
                Env: [
                    `AGENT_PORT=${agentInternalPort}`,
                    `JOB_ID=${jobId}`,
                    `AGENT_MAX_RETRIES=${CONFIG.AGENT_MAX_RETRIES}`,
                ],
                ExposedPorts: {
                    [`${agentInternalPort}/tcp`]: {}
                },
                HostConfig: {
                    AutoRemove: false,
                    Binds: binds,
                    PortBindings: {
                        [`${agentInternalPort}/tcp`]: [{ HostPort: `${agentHostPort}` }]
                    },
                    ...(isWindowsContainer ? {} : { ExtraHosts: ['host.docker.internal:host-gateway'] }),
                }
            };

            if (networkMode) {
                containerConfig.HostConfig.NetworkMode = networkMode;
            }

            const container = await this.docker.createContainer(containerConfig);
            console.log('[docker] Agent container created:', container.id);
            await container.start();
            console.log('[docker] Agent container started');

            // If we are in a container and have a network, use the internal hostname and port.
            // Otherwise, use localhost and the mapped host port.
            const useInternal = !!networkMode;
            return {
                containerId: container.id,
                host: useInternal ? containerName : 'localhost',
                port: useInternal ? agentInternalPort : agentHostPort
            };
        } catch (err) {
            console.error('[docker] Error creating/starting agent container:', err);
            throw err;
        }
    }

public async stopAgent(containerId: string) {
        try {
            if (useDockerCli) {
                execSync(`docker stop ${containerId}`, { stdio: 'ignore', timeout: 30000 });
                return;
            }
            const container = this.docker.getContainer(containerId);
            await container.stop();
        } catch (err) {
            console.error(`Failed to stop container ${containerId}:`, err);
        }
    }

    public async removeAgent(containerId: string) {
        try {
            if (useDockerCli) {
                execSync(`docker rm -f ${containerId}`, { stdio: 'ignore', timeout: 30000 });
                return;
            }
            const container = this.docker.getContainer(containerId);
            await container.remove({ force: true });
            console.log(`[docker] Removed container ${containerId}`);
        } catch (err) {
            console.error(`[docker] Failed to remove container ${containerId}:`, err);
        }
    }

public async getContainerStartedAt(containerId: string): Promise<string | null> {
        try {
            if (useDockerCli) {
                const startedAtStr = execSync(
                    `docker inspect --format="{{.State.StartedAt}}" ${containerId}`,
                    { encoding: 'utf-8', timeout: 10000 }
                ).trim();
                if (!startedAtStr) return null;
                const normalized = startedAtStr.replace(' ', 'T').replace(/\+00:00$/, 'Z');
                return new Date(normalized).toISOString();
            }
            const container = this.docker.getContainer(containerId);
            const info = await container.inspect();
            if (!info.State?.StartedAt) return null;
            return new Date(info.State.StartedAt).toISOString();
        } catch {
            return null;
        }
    }

    public async getContainerLogs(containerId: string): Promise<string> {
        try {
            if (useDockerCli) {
                return execSync(`docker logs ${containerId}`, { encoding: 'utf-8', timeout: 10000 }).trim() || 'No logs available';
            }
            const container = this.docker.getContainer(containerId);
            await container.inspect();
            const logBuffer = await container.logs({
                stdout: true,
                stderr: true,
                timestamps: false,
            });
            const raw = logBuffer as unknown as Buffer;
            const lines: string[] = [];
            let offset = 0;
            while (offset + 8 <= raw.length) {
                const size = raw.readUInt32BE(offset + 4);
                offset += 8;
                if (size > 0 && offset + size <= raw.length) {
                    lines.push(raw.slice(offset, offset + size).toString('utf8'));
                    offset += size;
                } else {
                    break;
                }
            }
            return lines.join('').trim() || 'No logs available';
        } catch {
            return 'No logs available';
        }
    }

    public async spawnOrchestratorContainer(projectId: number, projectPort: number, envVars: Record<string, string>): Promise<{ containerId: string }> {
        const orchImage = process.env.ORCHESTRATOR_IMAGE || 'openvelo-orchestrator:linux';
        const tempDataHostPath = CONFIG.TEMP_DATA_HOST_PATH;
        const toDockerPath = (p: string) => process.platform === 'win32' ? p.replace(/\\/g, '/') : p;

        if (useDockerCli) {
            const name = `openvelo-orchestrator-${projectId}-${Date.now()}`;
            const args: string[] = ['run', '-d', '--name', name];
            args.push('-v', '\\\\.\\pipe\\docker_engine:\\\\.\\pipe\\docker_engine');
            args.push('-v', `${toDockerPath(tempDataHostPath)}:/openvelo/temp_data`);
            args.push('-e', `PROJECT_ID=${projectId}`);
            args.push('-e', 'OPENVELO_CONTAINER_MODE=true');
            args.push('-e', 'OPENVELO_TEMP_DATA_PATH=/openvelo/temp_data');
            args.push('-e', `OPENVELO_TEMP_DATA_HOST_PATH=${toDockerPath(tempDataHostPath)}`);
            for (const [k, v] of Object.entries(envVars)) {
                args.push('-e', `${k}=${v}`);
            }
            args.push(orchImage);
            const cmd = `docker ${args.join(' ')}`;
            console.log(`[docker-manager] CLI spawn orchestrator: ${cmd}`);
            const containerId = execSync(cmd, { encoding: 'utf-8', timeout: 60000 }).trim();
            return { containerId };
        }

        const dockerSocketBind = process.platform === 'win32'
            ? '\\\\.\\pipe\\docker_engine:\\\\.\\pipe\\docker_engine'
            : '/var/run/docker.sock:/var/run/docker.sock';

        const container = await this.docker.createContainer({
            Image: orchImage,
            name: `openvelo-orchestrator-${projectId}-${Date.now()}`,
            Env: [
                `PROJECT_ID=${projectId}`,
                `OPENVELO_CONTAINER_MODE=true`,
                `OPENVELO_TEMP_DATA_PATH=/openvelo/temp_data`,
                `OPENVELO_TEMP_DATA_HOST_PATH=${toDockerPath(tempDataHostPath)}`,
                ...Object.entries(envVars).map(([k, v]) => `${k}=${v}`),
            ],
            HostConfig: {
                AutoRemove: false,
                Binds: [
                    dockerSocketBind,
                    `${toDockerPath(tempDataHostPath)}:/openvelo/temp_data`,
                ],
                ExtraHosts: process.platform !== 'win32' ? ['host.docker.internal:host-gateway'] : [],
            }
        });

        await container.start();
        return { containerId: container.id };
    }
}

export const dockerManager = new DockerManager();
