# Vetted AI Portal — Build Kickoff Prompt

Copy everything below the line into a new chat session to start the build.

---

## Prompt

I need you to build a full-stack web application called **Vetted AI Portal** — an enterprise AI chat platform for demonstration purposes. All specifications, Gherkin user stories, and design requirements are in the folder `vetted_portal_v2/`. Read the `README.md` first, then review each `.feature` file in the `features/` subfolder before writing any code.

### What to Build

An enterprise AI portal with the **Vetted** brand look and feel (minimalist, black + gold/amber `#C4A962` accent on white, serif headings, sans-serif body, generous whitespace). The portal has these modules:

1. **Sidebar Navigation** — Persistent left sidebar with: Vetted. logo, + New Chat, Projects, Library, Apps, Admin (admin only), Project Chats list, Recent Chats list, Shared With Me list, and user profile footer
2. **Chat Interface** — Prompt input ("Ask anything"), file attachments (paperclip icon), model selector dropdown, temperature slider, message bubbles, streaming responses, copy/regenerate actions, chat sharing
3. **Processing Pipeline / Progress Bar** — After submitting a prompt, show a vertical 6-step pipeline with timestamps: Resolving chat → Discovering tools → Loading history → Building prompt → Calling [Model Name] → Streaming response. Include an expandable "Model Reasoning" section. This is a KEY visual feature — see `04-processing-pipeline.feature` for exact specs.
4. **Projects** — CRUD with cards showing Owner badge, tool set count, updated date. Tabs for My Projects / Shared With Me. Create/share/delete projects. Project detail view with chats, files, settings, members.
5. **Library** — File list with checkboxes, type icons, storage meter (e.g., "261.8 KB | 3 files"), upload, download, rename, delete, bulk actions, search.
6. **Apps** — Grid of app cards with icons, categories, usage count. Admin can create/edit/disable/delete apps.
7. **Admin Dashboard** — Resources cards (AI Tool Sets, Model Configuration, System Prompts), Quick Stats (Total Users, Active Today, Projects), Support Tools (AI Tool Sets Health, Model Health), User Management table.
8. **User Settings** — Profile, Preferences, Notifications, API Keys, Security/Sessions.
9. **Global Search** — Ctrl+K modal with categorized results (Chats, Projects, Files, Apps).
10. **Notifications** — Toast messages (success/error/warning) and in-app notification bell with dropdown panel.
11. **Play Demo Button** — Fixed in the upper-left corner. Gold/amber button. When clicked, launches a 36-step automated walkthrough that spotlights and demonstrates every feature. Includes Pause/Play/Skip/Exit controls, a step counter ("Step 10 of 36"), keyboard shortcuts (Space=pause, arrows=skip, Esc=exit), welcome overlay at start, completion overlay at end. All demo actions use mock data and do NOT modify real data. See `14-demo-mode.feature` for the full walkthrough sequence.

### Technical Constraints (Demo Build)

- **Database**: Local **SQLite** file at `./data/vetted_portal.db`. WAL mode, foreign keys on. Pre-seed with demo data (26 users, 15 projects, sample chats/messages, sample files, 4 apps, 3 tool sets). Full schema is in `15-technical-architecture.feature`.
- **File Storage**: Local filesystem at `./data/uploads/` with subdirectories: `library/`, `projects/`, `avatars/`, `temp/`. Files saved as `{uuid}_{original_filename}`. Supported types: PDF, DOCX, XLSX, CSV, TXT, PNG, JPG, JSON, MD. Max 50MB per file.
- **AI Models**: List **Claude**, **ChatGPT**, and **Gemini** in the model selector dropdown — but they are **non-functional / mock only**. When a user submits a prompt, animate the 6-step processing pipeline with realistic simulated timing, then return a pre-written mock response matched by keyword (analyze → structured analysis, summarize → summary, code → code block, etc.). Also generate mock "Model Reasoning" data.
- **Auth**: Simplified for demo — pre-seeded users in SQLite, role-based (user, admin, super_admin).
- **Environment Variables**: `DEMO_MODE=true`, `SEED_DEMO_DATA=true`, `DATABASE_PATH=./data/vetted_portal.db`, `UPLOAD_DIR=./data/uploads`, `PORT=3000`.

### Vetted Design System

- **Logo**: "Vetted." — black serif font with period
- **Colors**: Primary `#1A1A1A`, Accent `#C4A962` (gold/amber), Background `#FFFFFF`, Surface `#F9FAFB`, Border `#E5E7EB`, Success `#10B981`, Warning `#F59E0B`, Danger `#EF4444`
- **Typography**: Headings = Serif (Playfair Display or similar), Body = Sans-serif (Inter or similar), Code = Monospace
- **Buttons**: Primary = black bg/white text/8px radius. Secondary = white bg/black border. Danger = red.
- **Cards**: White bg, 1px border `#E5E7EB`, 12px radius, subtle hover shadow.
- **Sidebar**: 280px expanded / 64px collapsed, white bg, active item has gold left border + `#F9FAFB` bg.
- **Full design tokens in `10-ui-design-system.feature`**

### Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS
- **State**: Zustand or Redux Toolkit
- **Backend**: Node.js (Express) or Python (FastAPI)
- **Database**: SQLite (better-sqlite3 for Node, or sqlite3 for Python)
- **Streaming simulation**: setTimeout / simulated SSE for mock responses

### How to Proceed

1. Read `README.md` and all 15 `.feature` files in `features/` for full specs
2. Set up the project scaffolding (frontend + backend + database)
3. Implement the SQLite schema and seed data first
4. Build the UI shell (sidebar + main content routing) with Vetted design system
5. Implement each module in order: Auth → Chat → Pipeline → Projects → Library → Apps → Admin → Settings → Search → Notifications → Error Handling → Demo Mode
6. Make sure the **Play Demo** walkthrough works end-to-end as the capstone feature
7. Everything should run locally with `npm start` or equivalent — zero external dependencies beyond npm packages
