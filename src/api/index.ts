const BASE = '/api';

async function request(path: string, options: RequestInit = {}) {
  const userId = localStorage.getItem('userId') || '';
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Auth
export const auth = {
  login: (email: string) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email }) }),
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
  ): Promise<any> =>
    new Promise(async (resolve, reject) => {
      try {
        const userId = localStorage.getItem('userId') || '';
        const res = await fetch(`${BASE}/chats/${id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          return reject(new Error(err.error || `HTTP ${res.status}`));
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
            const event = JSON.parse(line.slice(6));
            if (event.type === 'step') onStep({ message: event.message, ts: event.ts });
            else if (event.type === 'done') resolve(event);
            else if (event.type === 'error') reject(new Error(event.message));
          }
        }
      } catch (err) {
        reject(err);
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
  rename: (id: string, name: string) => request(`/library/${id}`, { method: 'PUT', body: JSON.stringify({ original_name: name }) }),
  delete: (id: string) => request(`/library/${id}`, { method: 'DELETE' }),
  stats: () => request('/library/stats').then(d => { const s = d.stats || d; return { totalSize: s.total_size || 0, fileCount: s.total_files || 0 }; }),
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
  users: () => request('/admin/users').then(d => d.users || d || []),
  updateRole: (id: string, role: string) => request(`/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  updateStatus: (id: string, status: string) => request(`/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  toolSets: () => request('/admin/tool-sets').then(d => d.toolSets || d.tool_sets || d || []),
  createToolSet: (data: any) => request('/admin/tool-sets', { method: 'POST', body: JSON.stringify(data) }),
  updateToolSet: (id: string, data: any) => request(`/admin/tool-sets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteToolSet: (id: string) => request(`/admin/tool-sets/${id}`, { method: 'DELETE' }),
  models: () => request('/admin/models').then(d => d.models || d || []),
  updateModel: (id: string, data: any) => request(`/admin/models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  systemPrompts: () => request('/admin/system-prompts').then(d => d.prompts || d.systemPrompts || d || []),
  createSystemPrompt: (data: any) => request('/admin/system-prompts', { method: 'POST', body: JSON.stringify(data) }),
  updateSystemPrompt: (id: string, data: any) => request(`/admin/system-prompts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSystemPrompt: (id: string) => request(`/admin/system-prompts/${id}`, { method: 'DELETE' }),
  health: () => request('/admin/health').then(d => d.health || d),
  errors: () => request('/admin/errors').then((d: any) => d.errors || []),
  reportClientError: (payload: { message: string; stack?: string; url?: string; userAgent?: string }) =>
    request('/admin/client-errors', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {}),
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
