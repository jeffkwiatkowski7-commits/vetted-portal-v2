export interface UsageListParams {
  page?: number;
  limit?: number;
  user_id?: string;
  source?: 'chat' | 'lease';
  model?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface UsageRow {
  id: string;
  user_id: string;
  display_name: string;
  department: string | null;
  source: 'chat' | 'lease';
  prompt: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  created_at: string;
}

export interface UsageListResponse {
  rows: UsageRow[];
  total: number;
  page: number;
  limit: number;
}

export interface UsageSummary {
  total_prompts: number;
  total_tokens: number;
  estimated_cost: number;
  active_users: number;
}

const BASE = '/api';

async function request(path: string, options: RequestInit = {}) {
  const userId = localStorage.getItem('userId') || '';
  const method = (options.method || 'GET').toUpperCase();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        ...options.headers,
      },
    });
  } catch (networkErr) {
    reportApiFailure({ method, path, status: 0, message: (networkErr as Error)?.message || 'Network error' });
    throw networkErr;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    const message = err.error || `HTTP ${res.status}`;
    reportApiFailure({ method, path, status: res.status, message });
    throw new Error(message);
  }
  return res.json();
}

// Report API failures to the server error log so admins can see what users hit.
// Skips 401s (normal auth bounces) and never reports failures of the reporter itself.
function reportApiFailure({ method, path, status, message }: { method: string; path: string; status: number; message: string }) {
  if (status === 401) return;
  if (path.startsWith('/admin/client-errors')) return;
  if (!localStorage.getItem('userId')) return;
  fetch(`${BASE}/admin/client-errors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': localStorage.getItem('userId') || '',
    },
    body: JSON.stringify({
      message: `${method} ${path} → ${status || 'network'}: ${message}`,
      url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    }),
  }).catch(() => {});
}

// Auth
export const auth = {
  login: (email: string, password: string) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me').then(d => d.user || d),
};

// Chats - unwrap backend response shapes
export const chats = {
  list: () => request('/chats').then(d => d.chats || d || []),
  create: (data: any) => request('/chats', { method: 'POST', body: JSON.stringify(data) }).then(d => d.chat || d),
  get: (id: string) => request(`/chats/${id}`).then(d => d.chat ? { ...d.chat, messages: d.messages || [] } : d),
  update: (id: string, data: any) => request(`/chats/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.chat || d),
  delete: (id: string) => request(`/chats/${id}`, { method: 'DELETE' }),
  sendMessage: (id: string, data: any) => request(`/chats/${id}/messages`, { method: 'POST', body: JSON.stringify(data) }),
  streamMessage: (
    id: string,
    data: any,
    onStep: (step: { message: string; ts: string }) => void,
    externalSignal?: AbortSignal,
    onAgentRunEvent?: (event: any) => void,
  ): Promise<any> =>
    new Promise(async (resolve, reject) => {
      const controller = new AbortController();
      // 3-minute overall timeout for the entire stream
      const timeout = setTimeout(() => {
        controller.abort('timeout');
        reject(new Error('Request timed out — the AI took too long to respond'));
      }, 180000);
      let settled = false;
      const settle = (fn: typeof resolve, val: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
        fn(val);
      };
      const onExternalAbort = () => {
        controller.abort('user-stopped');
        // Resolve (not reject) so callers can clean up UI without showing an error toast
        settle(resolve, { type: 'stopped' });
      };
      if (externalSignal) {
        if (externalSignal.aborted) return onExternalAbort();
        externalSignal.addEventListener('abort', onExternalAbort);
      }
      try {
        const userId = localStorage.getItem('userId') || '';
        const res = await fetch(`${BASE}/chats/${id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify(data),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          return settle(reject, new Error(err.error || `HTTP ${res.status}`));
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'step') onStep({ message: event.message, ts: event.ts });
              else if (event.type === 'done') return settle(resolve, event);
              else if (event.type === 'error') return settle(reject, new Error(event.message));
              else if (event.type?.startsWith('agent_run.') && onAgentRunEvent) onAgentRunEvent(event);
            } catch {
              // skip malformed SSE lines
            }
          }
        }
        // Stream ended without a done event — connection was likely dropped
        if (!settled) settle(reject, new Error('Connection lost — please try again'));
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          // User-stopped already settled via onExternalAbort; timeout already rejected.
          return;
        }
        settle(reject, err);
      }
    }),
  share: (id: string, data: any) => request(`/chats/${id}/share`, { method: 'POST', body: JSON.stringify(data) }),
  sharedWithMe: () => request('/chats/shared/with-me').then(d => d.chats || d || []),
};

// Projects - unwrap
export const projects = {
  list: () => request('/projects').then(d => d.projects || d || []),
  create: (data: any) => request('/projects', { method: 'POST', body: JSON.stringify(data) }).then(d => d.project || d),
  get: (id: string) => request(`/projects/${id}`).then(d => d.project || d),
  update: (id: string, data: any) => request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.project || d),
  delete: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),
  addMember: (id: string, data: any) => request(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify(data) }),
  removeMember: (id: string, userId: string) => request(`/projects/${id}/members/${userId}`, { method: 'DELETE' }),
};

// MCP Servers
export const mcpServers = {
  list: () => request('/mcp-servers').then(d => d.servers || []),
  adminList: () => request('/admin/mcp-servers').then(d => d.servers || []),
  adminCreate: (data: any) => request('/admin/mcp-servers', { method: 'POST', body: JSON.stringify(data) }).then(d => d.server),
  adminUpdate: (id: string, data: any) => request(`/admin/mcp-servers/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.server),
  adminDelete: (id: string) => request(`/admin/mcp-servers/${id}`, { method: 'DELETE' }),
  setChatServers: (chatId: string, serverIds: string[]) =>
    request(`/chats/${chatId}/mcp-servers`, { method: 'PUT', body: JSON.stringify({ serverIds }) }),
};

// Models - public endpoint for enabled models
export const models = {
  list: () => request('/models').then(d => d.models || d || []),
};

// Library - unwrap
export const library = {
  list: (projectId?: string) => request(projectId ? `/library?project_id=${projectId}` : '/library').then(d => d.files || d || []),
  upload: (file: File, projectId?: string, onProgress?: (percent: number) => void): Promise<any> =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      if (projectId) formData.append('project_id', projectId);
      const userId = localStorage.getItem('userId') || '';
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/library/upload`);
      xhr.setRequestHeader('X-User-Id', userId);
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
        } else {
          reject(new Error('Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    }),
  assignProject: (id: string, projectId: string | null) =>
    request(`/library/${id}`, { method: 'PUT', body: JSON.stringify({ project_id: projectId }) }),
  download: (id: string) => `${BASE}/library/${id}/download`,
  // Fetches the file with the X-User-Id auth header and triggers a Blob download.
  // Use this instead of window.open(download(id)) — the latter silently 401s.
  downloadAsBlob: async (id: string, filename: string): Promise<void> => {
    const userId = localStorage.getItem('userId') || '';
    const res = await fetch(`${BASE}/library/${id}/download`, {
      headers: { 'X-User-Id': userId },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  rename: (id: string, name: string) => request(`/library/${id}`, { method: 'PUT', body: JSON.stringify({ original_name: name }) }),
  delete: (id: string) => request(`/library/${id}`, { method: 'DELETE' }),
  stats: () => request('/library/stats').then(d => { const s = d.stats || d; return { totalSize: s.total_size || 0, fileCount: s.total_files || 0 }; }),
  promoteToLibrary: (id: string) =>
    request(`/library/${id}/promote`, { method: 'POST' }),
};

// Skills - unwrap
export const skills = {
  list: () => request('/skills').then(d => d.skills || d || []),
  create: (data: any) => request('/skills', { method: 'POST', body: JSON.stringify(data) }).then(d => d.skill || d),
  get: (id: string) => request(`/skills/${id}`).then(d => d.skill || d),
  update: (id: string, data: any) => request(`/skills/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.skill || d),
  delete: (id: string) => request(`/skills/${id}`, { method: 'DELETE' }),
  attachFile: (id: string, libraryFileId: string) => request(`/skills/${id}/files`, { method: 'POST', body: JSON.stringify({ library_file_id: libraryFileId }) }),
  detachFile: (id: string, fileId: string) => request(`/skills/${id}/files/${fileId}`, { method: 'DELETE' }),
  forProject: (projectId: string) => request(`/projects/${projectId}/skills`).then(d => d.skills || d || []),
  updateProjectSkills: (projectId: string, skills: { skill_id: string; enabled: boolean }[]) =>
    request(`/projects/${projectId}/skills`, { method: 'PUT', body: JSON.stringify({ skills }) }),
};

// Teams - unwrap
export const teams = {
  list: () => request('/teams').then(d => d.teams || d || []),
  create: (data: { name: string; description?: string; playbook?: string }) =>
    request('/teams', { method: 'POST', body: JSON.stringify(data) }).then(d => d.team || d),
  get: (id: string) => request(`/teams/${id}`).then(d => d.team || d),
  update: (id: string, data: any) =>
    request(`/teams/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.team || d),
  delete: (id: string) => request(`/teams/${id}`, { method: 'DELETE' }),
  addMember: (id: string, data: { project_id: string; purpose?: string }) =>
    request(`/teams/${id}/members`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.member || d),
  updateMember: (id: string, memberId: string, data: any) =>
    request(`/teams/${id}/members/${memberId}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.member || d),
  removeMember: (id: string, memberId: string) =>
    request(`/teams/${id}/members/${memberId}`, { method: 'DELETE' }),
};

export const chatTeam = {
  set: (chatId: string, teamId: string | null) =>
    request(`/chats/${chatId}/team`, { method: 'PUT', body: JSON.stringify({ team_id: teamId }) }),
};

// Scheduled tasks
export const tasks = {
  list: () => request('/tasks').then(d => d.tasks || d || []),
  get: (id: string) => request(`/tasks/${id}`),
  create: (data: any) => request('/tasks', { method: 'POST', body: JSON.stringify(data) }).then(d => d.task || d),
  update: (id: string, data: any) => request(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.task || d),
  delete: (id: string) => request(`/tasks/${id}`, { method: 'DELETE' }),
  run: (id: string) => request(`/tasks/${id}/run`, { method: 'POST' }),
  runs: (id: string) => request(`/tasks/${id}/runs`).then(d => d.runs || d || []),
};

// Apps - unwrap
export const apps = {
  list: () => request('/apps').then(d => d.apps || d || []),
  create: (data: any) => request('/apps', { method: 'POST', body: JSON.stringify(data) }).then(d => d.app || d),
  update: (id: string, data: any) => request(`/apps/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.app || d),
  delete: (id: string) => request(`/apps/${id}`, { method: 'DELETE' }),
  categories: () => request('/apps/categories').then(d => (d.categories || d || []).map((c: any) => c.id || c)),
};

// Admin - unwrap
export const admin = {
  stats: () => request('/admin/stats').then(d => d.stats || d),
  users: {
    list: () => request('/admin/users').then((d: any) => d.users || d || []),
    create: (data: { email: string; display_name: string; job_title?: string; department?: string; role?: string; password?: string }) =>
      request('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<{ email: string; display_name: string; job_title: string; department: string; role: string; status: string }>) =>
      request(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setPassword: (id: string, password: string) =>
      request(`/admin/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
    remove: (id: string) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  },
  toolSets: () => request('/admin/tool-sets').then(d => d.toolSets || d.tool_sets || d || []),
  createToolSet: (data: any) => request('/admin/tool-sets', { method: 'POST', body: JSON.stringify(data) }),
  updateToolSet: (id: string, data: any) => request(`/admin/tool-sets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteToolSet: (id: string) => request(`/admin/tool-sets/${id}`, { method: 'DELETE' }),
  getModels: () => request('/admin/models'),
  createModel: (data: any) => request('/admin/models', { method: 'POST', body: JSON.stringify(data) }),
  updateModel: (id: string, data: any) => request(`/admin/models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteModel: (id: string) => request(`/admin/models/${id}`, { method: 'DELETE' }),
  systemPrompts: () => request('/admin/system-prompts').then(d => d.prompts || d.systemPrompts || d || []),
  createSystemPrompt: (data: any) => request('/admin/system-prompts', { method: 'POST', body: JSON.stringify(data) }),
  updateSystemPrompt: (id: string, data: any) => request(`/admin/system-prompts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSystemPrompt: (id: string) => request(`/admin/system-prompts/${id}`, { method: 'DELETE' }),
  health: () => request('/admin/health').then(d => d.health || d),
  errors: () => request('/admin/errors').then((d: any) => d.errors || []),
  clearErrors: () => request('/admin/errors', { method: 'DELETE' }),
  reportClientError: (payload: { message: string; stack?: string; url?: string; userAgent?: string }) =>
    request('/admin/client-errors', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {}),
  usage: {
    list: (params?: UsageListParams): Promise<UsageListResponse> => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.user_id) qs.set('user_id', params.user_id);
      if (params?.source) qs.set('source', params.source);
      if (params?.model) qs.set('model', params.model);
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      if (params?.q) qs.set('q', params.q);
      const query = qs.toString();
      return request(`/admin/usage${query ? '?' + query : ''}`);
    },
    summary: (): Promise<UsageSummary> => request('/admin/usage/summary'),
    models: (): Promise<string[]> => request('/admin/usage/models'),
  },
  chatHistory: {
    list: (params?: { page?: number; limit?: number; user_id?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.user_id) qs.set('user_id', params.user_id);
      if (params?.q) qs.set('q', params.q);
      const query = qs.toString();
      return request(`/admin/chat-history${query ? '?' + query : ''}`);
    },
    remove: (id: string) => request(`/admin/chat-history/${id}`, { method: 'DELETE' }),
  },
};

// Settings - unwrap
export const settings = {
  profile: () => request('/settings/profile').then(d => d.user || d.profile || d),
  updateProfile: (data: any) => request('/settings/profile', { method: 'PUT', body: JSON.stringify(data) }),
  preferences: () => request('/settings/preferences').then(d => d.preferences || d),
  updatePreferences: (data: any) => request('/settings/preferences', { method: 'PUT', body: JSON.stringify(data) }),
  apiKeys: () => request('/settings/api-keys').then(d => Array.isArray(d.api_keys) ? d.api_keys : Array.isArray(d.apiKeys) ? d.apiKeys : []),
  createApiKey: (data: any) => request('/settings/api-keys', { method: 'POST', body: JSON.stringify(data) }),
  deleteApiKey: (id: string) => request(`/settings/api-keys/${id}`, { method: 'DELETE' }),
  sessions: () => request('/settings/sessions').then(d => d.sessions || d || []),
};

// Project Files
export const projectFiles = {
  upload: (
    projectId: string,
    file: File,
    onStep: (step: { message: string; ts: string }) => void,
  ): Promise<any> =>
    new Promise(async (resolve, reject) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('Upload timed out'));
      }, 300000); // 5 min for file indexing
      let settled = false;
      const settle = (fn: typeof resolve, val: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn(val);
      };
      try {
        const userId = localStorage.getItem('userId') || '';
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${BASE}/projects/${projectId}/files/upload`, {
          method: 'POST',
          headers: { 'X-User-Id': userId },
          body: formData,
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Upload failed' }));
          return settle(reject, new Error(err.error || `HTTP ${res.status}`));
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'step') onStep({ message: event.message, ts: event.ts });
              else if (event.type === 'done') return settle(resolve, event);
              else if (event.type === 'error') return settle(reject, new Error(event.message));
            } catch {
              // skip malformed SSE lines
            }
          }
        }
        if (!settled) settle(reject, new Error('Connection lost — please try again'));
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        settle(reject, err);
      }
    }),
};

// Search - unwrap
export const search = {
  query: (q: string) => request(`/search?q=${encodeURIComponent(q)}`).then(d => d.results || d),
};

// Notifications - unwrap
export const notifications = {
  list: () => request('/notifications').then(d => d.notifications || d || []),
  markRead: (id: string) => request(`/notifications/${id}/read`, { method: 'PUT' }),
  markAllRead: () => request('/notifications/read-all', { method: 'PUT' }),
};

// PPTX Templates
export const pptxTemplates = {
  list: (opts?: { includeArchived?: boolean }) => {
    const q = opts?.includeArchived ? '?include=archived' : '';
    return request(`/pptx-templates${q}`).then((d: any) => d.templates || d || []);
  },
  get: (id: string) => request(`/pptx-templates/${id}`).then((d: any) => d.template || d),
  upload: (file: File, body: { name: string; template_type: string }, onProgress?: (pct: number) => void): Promise<any> =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', body.name);
      formData.append('template_type', body.template_type);
      const userId = localStorage.getItem('userId') || '';
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/pptx-templates`);
      xhr.setRequestHeader('X-User-Id', userId);
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
        } else {
          let msg = 'Upload failed';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    }),
  replace: (id: string, file: File): Promise<any> =>
    new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      const userId = localStorage.getItem('userId') || '';
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/pptx-templates/${id}/replace`);
      xhr.setRequestHeader('X-User-Id', userId);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
        } else {
          let msg = 'Replace failed';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Replace failed'));
      xhr.send(formData);
    }),
  patch: (id: string, body: { name?: string; status?: 'active' | 'archived' }) =>
    request(`/pptx-templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }).then((d: any) => d.template || d),
  remove: (id: string) => request(`/pptx-templates/${id}`, { method: 'DELETE' }),
  // <img> tags can't send custom headers, so fall back to the userId query param
  // which requireAuth accepts as an alternative to X-User-Id.
  thumbnailUrl: (id: string) => {
    const userId = localStorage.getItem('userId') || '';
    return `${BASE}/pptx-templates/${id}/thumbnail?userId=${encodeURIComponent(userId)}`;
  },
};

export const adminPptxTemplates = {
  forUser: (userId: string) =>
    request(`/admin/pptx-templates?user_id=${encodeURIComponent(userId)}`).then((d: any) => d.templates || d || []),
};
