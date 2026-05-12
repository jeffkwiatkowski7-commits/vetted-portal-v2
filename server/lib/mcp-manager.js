/**
 * MCP Process Manager — singleton that manages MCP server child processes.
 * Servers start lazily on first request, idle-reap after 10 minutes.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { decryptEnvVars } from './secrets.js';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const CALL_TIMEOUT_MS = 30 * 1000;       // 30 seconds per tool call

// MCP children are model-invokable — never inherit the portal's full env
// (Opus_API_KEY, GCP ADC, DATABASE_PATH, etc). Allowlist only the vars a
// child runtime needs to function; per-server env_vars are layered on top.
const MCP_ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL',
  'LANG', 'LC_ALL', 'TERM',
  'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  'NODE_ENV',
];

function baseChildEnv() {
  const e = {};
  for (const k of MCP_ENV_ALLOWLIST) {
    if (process.env[k] !== undefined) e[k] = process.env[k];
  }
  return e;
}

class McpManager {
  constructor() {
    this._connections = new Map();
    this._reapInterval = setInterval(() => this._reapIdle(), 60_000);
  }

  async startServer(serverConfig) {
    if (this._connections.has(serverConfig.id)) {
      await this.stopServer(serverConfig.id);
    }

    const args = JSON.parse(serverConfig.args || '[]');
    const envVars = decryptEnvVars(serverConfig.env_vars);

    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args,
      env: { ...baseChildEnv(), ...envVars },
    });

    const client = new Client({
      name: 'vetted-portal',
      version: '1.0.0',
    });

    await client.connect(transport);

    this._connections.set(serverConfig.id, {
      client,
      transport,
      config: serverConfig,
      lastUsed: Date.now(),
    });

    return client;
  }

  async stopServer(serverId) {
    const conn = this._connections.get(serverId);
    if (!conn) return;
    try {
      await conn.client.close();
    } catch (e) {
      console.warn(`[mcp] error closing ${serverId}:`, e.message);
    }
    this._connections.delete(serverId);
  }

  async _getClient(serverConfig) {
    const conn = this._connections.get(serverConfig.id);
    if (conn) {
      conn.lastUsed = Date.now();
      return conn.client;
    }
    return this.startServer(serverConfig);
  }

  async getTools(serverConfig) {
    const client = await this._getClient(serverConfig);
    const result = await client.listTools();
    return result.tools || [];
  }

  async callTool(serverConfig, toolName, args) {
    const client = await this._getClient(serverConfig);
    const result = await Promise.race([
      client.callTool({ name: toolName, arguments: args }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Tool call timed out after ${CALL_TIMEOUT_MS / 1000}s`)), CALL_TIMEOUT_MS)
      ),
    ]);

    if (result.content && Array.isArray(result.content)) {
      return result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
    return JSON.stringify(result.content || result);
  }

  async stopAll() {
    clearInterval(this._reapInterval);
    const ids = [...this._connections.keys()];
    await Promise.all(ids.map(id => this.stopServer(id)));
  }

  _reapIdle() {
    const now = Date.now();
    for (const [id, conn] of this._connections) {
      if (now - conn.lastUsed > IDLE_TIMEOUT_MS) {
        console.log(`[mcp] reaping idle server: ${conn.config.name}`);
        this.stopServer(id);
      }
    }
  }
}

const mcpManager = new McpManager();
export default mcpManager;
