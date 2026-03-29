import React, { useState, useEffect } from 'react';
import { Search, Globe, Brain, Terminal, Link, Lightbulb, Cpu, Puzzle } from 'lucide-react';
import * as api from '../api';

const ICON_MAP: Record<string, React.ElementType> = {
  search: Search, globe: Globe, brain: Brain,
  terminal: Terminal, link: Link, lightbulb: Lightbulb,
};

export default function IntegrationsPage() {
  const [servers, setServers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
    api.mcpServers.list().then(setServers).catch(() => {});
    api.projects.list().then(setProjects).catch(() => {});
  }, []);

  // Build map: serverId -> project names using it
  const serverProjects: Record<string, string[]> = {};
  for (const p of projects) {
    let mcpIds: string[] = [];
    try { mcpIds = JSON.parse(p.mcp_servers || '[]'); } catch {}
    for (const id of mcpIds) {
      if (!serverProjects[id]) serverProjects[id] = [];
      serverProjects[id].push(p.name);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-vetted-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Puzzle size={20} className="text-vetted-accent" />
          <div>
            <h1 className="text-xl font-serif text-vetted-primary">Integrations</h1>
            <p className="text-sm text-vetted-text-secondary mt-0.5">AI tools available in your projects and chats</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-4">
          {servers.map((server) => {
            const IconComp = ICON_MAP[server.icon] || Cpu;
            const usedIn = serverProjects[server.id] || [];
            return (
              <div key={server.id} className="border border-vetted-border rounded-xl bg-white p-5">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-lg bg-vetted-accent/10 flex-shrink-0">
                    <IconComp size={20} className="text-vetted-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-vetted-primary">{server.name}</h3>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Available</span>
                    </div>
                    <p className="text-sm text-vetted-text-secondary leading-relaxed">{server.description}</p>
                    {usedIn.length > 0 && (
                      <p className="text-xs text-vetted-text-muted mt-2">Used in: {usedIn.join(', ')}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
