# Vetted AI Portal - API Reference Card

**Base URL:** `http://localhost:3000/api`
**Authentication:** `X-User-Id` header (demo mode)
**Content-Type:** `application/json`

---

## Authentication

### Login
```
POST /auth/login
Body: { "email": "user@company.com" }
Response: { "user": { id, email, display_name, role, avatar_path } }
```

### Logout
```
POST /auth/logout
Response: { "success": true }
```

### Get Current User
```
GET /auth/me
Response: { "user": { ...user details } }
```

---

## Chats

### List Chats
```
GET /chats
Response: { "chats": [{ id, title, model, message_count, created_at, updated_at, ... }] }
```

### Create Chat
```
POST /chats
Body: { "title": string, "model": string, "project_id"?: string, "temperature"?: number }
Response: { "chat": { id, ...chat details } }
```

### Get Chat with Messages
```
GET /chats/:id
Response: { "chat": {...}, "messages": [{ id, role, content, created_at, ... }] }
```

### Update Chat
```
PUT /chats/:id
Body: { "title"?: string, "model"?: string, "temperature"?: number }
Response: { "chat": {...updated} }
```

### Delete Chat
```
DELETE /chats/:id
Response: { "success": true }
```

### Send Message (Critical Route - Gets Mock AI Response)
```
POST /chats/:id/messages
Body: { "content": string, "attachments"?: array }
Response: {
  "messages": [
    { id, role: "user", content, created_at },
    { id, role: "assistant", content, reasoning, created_at }
  ],
  "timing": { processing_time_ms, tokens_generated, response_time_ms }
}
```

### Share Chat
```
POST /chats/:id/share
Body: { "shared_with": string (user_id), "permission": "view" | "edit" }
Response: { "share": { id, chat_id, shared_by, shared_with, ... } }
```

### Get Shared Chats
```
GET /chats/shared/with-me
Response: { "chats": [{ ...chat details, shared_by, shared_by_name }] }
```

---

## Projects

### List Projects
```
GET /projects
Response: { "projects": [{ id, name, owner_id, description, ... }] }
```

### Create Project
```
POST /projects
Body: { "name": string, "description"?: string, "default_model"?: string }
Response: { "project": {...} }
```

### Get Project with Members
```
GET /projects/:id
Response: { "project": {...}, "members": [{ id, user_id, permission, ... }] }
```

### Update Project
```
PUT /projects/:id
Body: { "name"?: string, "description"?: string, "temperature"?: number }
Response: { "project": {...updated} }
```

### Delete Project
```
DELETE /projects/:id
Response: { "success": true }
```

### Add Project Member
```
POST /projects/:id/members
Body: { "user_id": string, "permission": "viewer" | "editor" }
Response: { "member": { id, project_id, user_id, permission, ... } }
```

### Remove Project Member
```
DELETE /projects/:id/members/:userId
Response: { "success": true }
```

---

## Library (File Management)

### List Files
```
GET /library
Response: { "files": [{ id, filename, original_name, file_size, mime_type, ... }] }
```

### Upload File
```
POST /library/upload
Form Data: file (binary), project_id (optional)
Response: { "file": { id, filename, file_path, file_size, ... } }
```

### Download File
```
GET /library/:id/download
Response: File binary (browser downloads)
```

### Rename File
```
PUT /library/:id
Body: { "original_name": string }
Response: { "file": {...updated} }
```

### Delete File
```
DELETE /library/:id
Response: { "success": true }
```

### File Statistics
```
GET /library/stats
Response: { "stats": { total_files, total_size, file_types } }
```

---

## Apps

### List Apps
```
GET /apps
Response: { "apps": [{ id, name, description, category, model, icon, ... }] }
```

### Create App (Admin Only)
```
POST /apps
Body: { "name": string, "description": string, "category": string, "model": string }
Response: { "app": {...} }
```

### Update App (Admin Only)
```
PUT /apps/:id
Body: { "name"?: string, "category"?: string, "model"?: string }
Response: { "app": {...updated} }
```

### Delete App (Admin Only)
```
DELETE /apps/:id
Response: { "success": true }
```

### Get Categories
```
GET /apps/categories
Response: { "categories": [{ id, name, description }] }
```

---

## Admin

### System Statistics
```
GET /admin/stats (admin only)
Response: { "stats": { active_users, total_chats, total_projects, total_messages, timestamp } }
```

### List Users
```
GET /admin/users (admin only)
Response: { "users": [{ id, email, display_name, role, status, ... }] }
```

### Update User Role
```
PUT /admin/users/:id/role (admin only)
Body: { "role": "user" | "admin" }
Response: { "user": {...updated} }
```

### Update User Status
```
PUT /admin/users/:id/status (admin only)
Body: { "status": "active" | "inactive" | "suspended" }
Response: { "user": {...updated} }
```

### List Tool Sets
```
GET /admin/tool-sets (admin only)
Response: { "tool_sets": [...] }
```

### Create Tool Set
```
POST /admin/tool-sets (admin only)
Body: { "name": string, "description": string, "tools": array }
Response: { "tool_set": {...} }
```

### Update Tool Set
```
PUT /admin/tool-sets/:id (admin only)
Body: { "name"?: string, "tools"?: array }
Response: { "tool_set": {...updated} }
```

### Delete Tool Set
```
DELETE /admin/tool-sets/:id (admin only)
Response: { "success": true }
```

### List Models
```
GET /admin/models (admin only)
Response: { "models": [{ id, model_name, display_name, is_default, is_enabled, ... }] }
```

### Update Model Config
```
PUT /admin/models/:id (admin only)
Body: { "is_enabled"?: boolean, "max_tokens"?: number, "rate_limit"?: number }
Response: { "model": {...updated} }
```

### List System Prompts
```
GET /admin/system-prompts (admin only)
Response: { "prompts": [{ id, name, prompt_text, scope, status, ... }] }
```

### Create System Prompt
```
POST /admin/system-prompts (admin only)
Body: { "name": string, "prompt_text": string, "scope": string }
Response: { "prompt": {...} }
```

### Update System Prompt
```
PUT /admin/system-prompts/:id (admin only)
Body: { "name"?: string, "prompt_text"?: string }
Response: { "prompt": {...updated} }
```

### Health Check
```
GET /admin/health
Response: { "status": "healthy", "uptime": number, "environment": string }
```

---

## Settings

### Get Profile
```
GET /settings/profile
Response: { "profile": { id, email, display_name, job_title, department, ... } }
```

### Update Profile
```
PUT /settings/profile
Body: { "display_name"?: string, "job_title"?: string, "department"?: string }
Response: { "profile": {...updated} }
```

### Get Preferences
```
GET /settings/preferences
Response: { "preferences": { default_model, default_temperature, notify_*, ... } }
```

### Update Preferences
```
PUT /settings/preferences
Body: { "default_model"?: string, "show_reasoning"?: boolean, "code_theme"?: string, ... }
Response: { "preferences": {...updated} }
```

### List API Keys
```
GET /settings/api-keys
Response: { "api_keys": [{ id, name, key_preview, expires_at, status, ... }] }
```

### Create API Key
```
POST /settings/api-keys
Body: { "name": string, "permissions"?: array, "expires_at"?: string }
Response: { "api_key": { id, name, key (full key - only shown once!), key_preview, ... } }
```

### Delete API Key
```
DELETE /settings/api-keys/:id
Response: { "success": true }
```

### List Sessions
```
GET /settings/sessions
Response: { "sessions": [{ id, expires_at, created_at }] }
```

---

## Search

### Search All
```
GET /search?q=search_term
Response: {
  "results": {
    "chats": [{ type: "chat", id, title, ... }],
    "projects": [{ type: "project", id, name, ... }],
    "files": [{ type: "file", id, original_name, ... }],
    "apps": [{ type: "app", id, name, ... }]
  }
}
```

---

## Notifications

### List Notifications
```
GET /notifications
Response: { "notifications": [{ id, type, title, description, is_read, ... }] }
```

### Mark as Read
```
PUT /notifications/:id/read
Response: { "notification": {...updated, is_read: 1} }
```

### Mark All as Read
```
PUT /notifications/read-all
Response: { "success": true }
```

---

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK - Success |
| 201 | Created - Resource created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing/invalid auth |
| 403 | Forbidden - Permission denied |
| 404 | Not Found - Resource doesn't exist |
| 500 | Server Error |

---

## Common Request Pattern

```bash
# Set headers
curl -X METHOD \
  -H "X-User-Id: YOUR_USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}' \
  http://localhost:3000/api/endpoint
```

---

## Demo Credentials

```
Email                        Role    Department
admin@vetted.com            Admin   Product
james.wilson@company.com    User    Engineering
emily.rodriguez@company.com User    Analytics
michael.kim@company.com     User    Design
lisa.park@company.com       User    Marketing
david.thompson@company.com  User    Finance
```

Use `POST /auth/login` with any email to get a user ID.

---

## Key Endpoints

| Purpose | Method | Endpoint |
|---------|--------|----------|
| **Create Chat** | POST | `/chats` |
| **Send Message** | POST | `/chats/:id/messages` |
| **Create Project** | POST | `/projects` |
| **Upload File** | POST | `/library/upload` |
| **Create App** | POST | `/apps` (admin) |
| **Search** | GET | `/search?q=term` |
| **Get Stats** | GET | `/admin/stats` (admin) |
| **User Profile** | GET | `/settings/profile` |
| **Create API Key** | POST | `/settings/api-keys` |
| **Health Check** | GET | `/admin/health` |
