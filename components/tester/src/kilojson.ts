import * as fs from 'fs';
import * as path from 'path';

/**
 * Write the project-level kilo.json permissions block. The MCP server
 * is configured via the ACP `session/new mcpServers` payload in
 * `workflow.ts runTest()` (per kilo's ACP mcpServers schema, which
 * discriminates by `type` and only accepts `sse`/`http` for remote
 * servers) — it is NOT included in this file.
 */
export function writeKiloJson(): void {
    const cfg = {
        $schema: 'https://kilo.ai/config.json',
        permission: {
            '*': 'allow',
            ask_user: 'deny',
            question: 'deny',
            task: 'deny',
            external_directory: {
                '/': 'allow',
                '/**': 'allow',
            },
        },
    };
    fs.writeFileSync(path.join('/repo', 'kilo.json'), JSON.stringify(cfg, null, 2), 'utf-8');
}