# Skills Feature Design Spec

**Date:** 2026-03-23
**Status:** Approved

## Overview

Skills are saved prompt injections — named, reusable instruction sets that get prepended to the system prompt when activated inside a project. They can optionally reference files from the existing Library; attached file content is extracted and injected into context at runtime.

## Data Model

### skills table
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID |
| name | TEXT NOT NULL | |
| description | TEXT | Optional |
| instructions | TEXT NOT NULL | Core prompt injection |
| created_at | TEXT NOT NULL | ISO 8601 |
| updated_at | TEXT NOT NULL | ISO 8601 |

### skill_files join table
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID |
| skill_id | TEXT NOT NULL | FK → skills |
| library_file_id | TEXT NOT NULL | FK → library_files |
| created_at | TEXT NOT NULL | ISO 8601 |
| UNIQUE | (skill_id, library_file_id) | |

### project_skills join table
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID |
| project_id | TEXT NOT NULL | FK → projects |
| skill_id | TEXT NOT NULL | FK → skills |
| enabled | INTEGER NOT NULL DEFAULT 1 | Boolean |
| created_at | TEXT NOT NULL | ISO 8601 |
| UNIQUE | (project_id, skill_id) | |

## API Routes

### Skills CRUD
- `GET /api/skills` — list all skills (with file count)
- `POST /api/skills` — create skill `{name, description?, instructions}`
- `GET /api/skills/:id` — get skill with attached files
- `PUT /api/skills/:id` — update skill fields
- `DELETE /api/skills/:id` — delete skill + cascade skill_files, project_skills

### Skill File Attachments
- `POST /api/skills/:id/files` — attach library file `{library_file_id}`
- `DELETE /api/skills/:id/files/:fileId` — detach file

### Project Skills
- `GET /api/projects/:id/skills` — list all skills with enabled state for project
- `PUT /api/projects/:id/skills` — bulk update `{skills: [{skill_id, enabled}]}`

## Frontend

### Types
```typescript
interface Skill {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  created_at: string;
  updated_at: string;
  file_count?: number;
  files?: LibraryFile[];
}

interface ProjectSkill {
  skill_id: string;
  skill_name: string;
  skill_description?: string;
  enabled: boolean;
}
```

### Sidebar
- New "Skills" nav item with Sparkles icon, between Library and Apps
- Path: `/skills`

### Pages
- `/skills` — SkillsPage: card grid of all skills, search, "New Skill" button
- `/skills/new` — SkillEditPage: create form
- `/skills/:id/edit` — SkillEditPage: edit form with delete

### Skill Edit Form
1. Name (text input, required)
2. Description (text input, optional)
3. Instructions (large textarea, auto-growing)
4. Attached Files — "Browse Library" button opens LibraryPickerModal, selected files shown as removable chips
5. Save / Delete buttons

### Project Integration
- In ProjectForm.tsx, add "Skills" section below MCP Tools
- Same toggle pattern as MCP tools
- Persisted via `PUT /api/projects/:id/skills`

## Runtime Prompt Assembly

When building system prompt for a project chat:
1. Start with base/project system prompt
2. Query `project_skills` WHERE `enabled = 1` for this project
3. For each active skill, fetch instructions + resolve attached file contents via `skill_files` → `library_files`
4. Append skill blocks:

```xml
<skill name="[Skill Name]">
[instructions text]

<file name="[filename]">
[extracted file content]
</file>
</skill>
```

- Skip non-text files (note filename only)
- Truncate large files to ~4000 tokens with truncation notice
