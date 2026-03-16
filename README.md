# Vetted AI Portal — Detailed Specifications (v2)

## Overview

This repository contains the complete Gherkin-based specifications for the **Vetted AI Portal**, an enterprise AI chat platform built with the **Vetted** brand identity. This is a **demonstration build** — AI models (Claude, ChatGPT, Gemini) are listed but non-functional, data persists in local SQLite, and file uploads use the local filesystem. A **Play Demo** walkthrough button showcases all portal features automatically.

## Key Technical Decisions (Demo Build)

| Decision | Implementation | Notes |
|---|---|---|
| **Database** | Local SQLite (`./data/vetted_portal.db`) | WAL mode, pre-seeded with demo data |
| **File Storage** | Local filesystem (`./data/uploads/`) | Subdirs for library, projects, avatars |
| **AI Models** | Claude, ChatGPT, Gemini (mock/non-functional) | Returns pre-written contextual responses |
| **Demo Mode** | `DEMO_MODE=true` env variable | Enables mock responses + Play Demo button |
| **Auth** | SSO (simplified for demo) | Role-based: user, admin, super_admin |

## Brand Identity Reference

The portal follows the **Vetted** look and feel (sourced from vettedportal.com):

| Element | Specification |
|---|---|
| **Logo** | "Vetted." — black serif font with period |
| **Primary Color** | `#1A1A1A` (near-black) — buttons, headings |
| **Accent Color** | `#C4A962` (gold/amber) — highlights, active states, decorative elements |
| **Background** | `#FFFFFF` (white) — clean, spacious |
| **Typography - Headings** | Serif font (e.g., Playfair Display), bold |
| **Typography - Body** | Sans-serif font (e.g., Inter), regular |
| **Buttons - Primary** | Black background, white text, rounded |
| **Buttons - Secondary** | White background, black border, rounded |
| **Aesthetic** | Minimalist, enterprise-grade, generous whitespace |

## Feature Files

| # | File | Module | Scenarios |
|---|---|---|---|
| 01 | `01-authentication.feature` | SSO Login, Roles, Sessions, Logout | 7 |
| 02 | `02-sidebar-navigation.feature` | Sidebar Layout, Collapse, Project/Recent/Shared Chats, Profile | 12 |
| 03 | `03-chat-interface.feature` | Prompt Input, File Attach, Model Select (Claude/ChatGPT/Gemini), Temperature, Streaming, Sharing | 22 |
| 04 | `04-processing-pipeline.feature` | Progress Bar, 6-Step Pipeline, Timestamps, Model Reasoning, Errors | 12 |
| 05 | `05-projects.feature` | Projects CRUD, Cards, Sharing, Files, Settings, Search | 14 |
| 06 | `06-library.feature` | File List, Storage Meter, Upload (local), Actions, Bulk Ops, Search | 17 |
| 07 | `07-apps.feature` | App Cards, Categories, Search, Create/Edit/Delete (Admin) | 10 |
| 08 | `08-admin-dashboard.feature` | Resources, Tool Sets, Model Config, System Prompts, Stats, Health, Users, Analytics | 16 |
| 09 | `09-user-settings.feature` | Profile, Preferences, Notifications, API Keys, Security | 11 |
| 10 | `10-ui-design-system.feature` | Colors, Typography, Spacing, Buttons, Cards, Inputs, Layout, Responsive, Animations, A11y | 16 |
| 11 | `11-notifications-toasts.feature` | Toast Messages, In-App Notifications, Notification Types | 7 |
| 12 | `12-search-global.feature` | Global Search Modal, Categorized Results, Keyboard Shortcut | 5 |
| 13 | `13-error-handling.feature` | Network Errors, AI Errors, Validation, 404, Permissions, Data Preservation | 9 |
| 14 | `14-demo-mode.feature` | **Play Demo Button, Pause/Play, 36-Step Walkthrough, Spotlight System, Simulated Data** | 16 |
| 15 | `15-technical-architecture.feature` | **SQLite Schema, Local File Storage, Mock AI Models, Demo Configuration** | 22 |

**Total: ~196 scenarios across 15 feature files**

## Portal Layout Reference (from PDF screenshots)

### Main Chat Interface (with Play Demo button)
```
+--[▶ Play Demo]---+-------------------------------------------+
| SIDEBAR          | MAIN CONTENT AREA                         |
| [Vetted. Logo]   |                                           |
| [+ New Chat]     |     Welcome to Vetted AI                  |
| [Projects]       |                                           |
| [Library]        |     [Subtitle text about capabilities]    |
| [Apps]           |                                           |
| [Admin]          |                                           |
|------------------|                                           |
| PROJECT CHATS    |                                           |
|  > Project A     |                                           |
|  > Project B     |                                           |
|------------------|                                           |
| RECENT CHATS     |                                           |
|  > Chat title 1  |                                           |
|  > Chat title 2  |                                           |
|------------------|   +-----------------------------------+   |
| SHARED WITH ME   |   | Ask anything            [Send]   |   |
|  > Shared chat 1 |   +-----------------------------------+   |
|------------------|-------------------------------------------+
| [User Profile]   |                          [Demo Mode] badge|
+------------------+-------------------------------------------+
```

### Demo Control Bar (visible during walkthrough)
```
+-------------------------------------------------------+
| ⏸ Pause | Step 10 of 36: Processing Pipeline | ⏭ | ✕  |
| [==========--------------------------] 28% complete    |
+-------------------------------------------------------+
```

### Processing Pipeline / Progress Bar
```
+--------------------------------------------------+
| Processing Pipeline                               |
|                                                    |
|  [✓] Resolving chat .................. 0.1s       |
|  [✓] Discovering tools ............... 0.3s       |
|  [✓] Loading history ................. 0.2s       |
|  [✓] Building prompt ................. 0.5s       |
|  [●] Calling Claude .................. 1.2s       |
|  [ ] Streaming response                           |
|                                                    |
+--------------------------------------------------+
| ▼ Model Reasoning                                 |
|   [Expandable section with AI thought process]    |
+--------------------------------------------------+
```

### Model Selector (Demo Mode)
```
+---------------------------+
| Select Model              |
| ● Claude     [Demo] 🟣   |
| ○ ChatGPT    [Demo] 🟢   |
| ○ Gemini     [Demo] 🔵   |
+---------------------------+
```

### Projects Page
```
+--------------------------------------------------+
| Projects                                          |
| [My Projects (3)] [Shared With Me (1)]            |
| [Search projects...]              [+ New Project] |
|                                                    |
| +-------------+ +-------------+ +-------------+  |
| | Project A   | | Project B   | | Project C   |  |
| | Owner badge | | Owner badge | | Editor      |  |
| | 3 tool sets | | 1 tool set  | | 2 tool sets |  |
| | Updated 2d  | | Updated 1w  | | Updated 5h  |  |
| +-------------+ +-------------+ +-------------+  |
+--------------------------------------------------+
```

### Library Page
```
+--------------------------------------------------+
| Library                                           |
| [Search files...]                    [+ Upload]   |
| Storage: [====------] 261.8 KB | 3 files          |
|                                                    |
| [☐] 📄 report.pdf          PDF    150 KB  2d ago |
| [☐] 📊 data.xlsx           XLSX    85 KB  5d ago |
| [☐] 📝 notes.txt           TXT     27 KB  1w ago |
+--------------------------------------------------+
```

### Admin Dashboard
```
+--------------------------------------------------+
| Admin Dashboard                                   |
|                                                    |
| RESOURCES                                         |
| +----------------+ +------------------+ +--------+|
| | AI Tool Sets   | | Model Config     | | System ||
| | [Tools icon]   | | [Brain icon]     | | Prompts||
| +----------------+ +------------------+ +--------+|
|                                                    |
| QUICK STATS                                       |
| +----------+ +-------------+ +----------+         |
| | Total    | | Active      | | Projects |         |
| | Users    | | Today       | |          |         |
| |   26     | |    8        | |   15     |         |
| +----------+ +-------------+ +----------+         |
|                                                    |
| SUPPORT TOOLS                                     |
| +--------------------+ +------------------+       |
| | AI Tool Sets Health| | Model Health     |       |
| | [Status indicators]| | [Status indica.] |       |
| +--------------------+ +------------------+       |
+--------------------------------------------------+
```

## Technology Stack (Demo Build)

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | React + TypeScript | Component-based UI, type safety |
| **Styling** | Tailwind CSS | Rapid styling matching Vetted design tokens |
| **State Management** | Zustand or Redux Toolkit | Chat state, user session, sidebar state |
| **Real-time** | Simulated SSE / setTimeout | Mock streaming for demo responses |
| **Backend** | Node.js (Express) or Python (FastAPI) | API layer, serves static files |
| **Database** | **SQLite** (local file) | Zero config, pre-seeded with demo data |
| **File Storage** | **Local filesystem** (`./data/uploads/`) | No cloud dependencies |
| **Auth** | Simplified SSO / local auth | Demo users pre-seeded in SQLite |
| **AI Models** | **Mock engine** | Claude, ChatGPT, Gemini listed — returns pre-written responses |

## Local Data Structure

```
vetted_portal_v2/
├── README.md                    # This file
├── features/                    # All Gherkin specifications
│   ├── 01-authentication.feature
│   ├── 02-sidebar-navigation.feature
│   ├── 03-chat-interface.feature
│   ├── 04-processing-pipeline.feature
│   ├── 05-projects.feature
│   ├── 06-library.feature
│   ├── 07-apps.feature
│   ├── 08-admin-dashboard.feature
│   ├── 09-user-settings.feature
│   ├── 10-ui-design-system.feature
│   ├── 11-notifications-toasts.feature
│   ├── 12-search-global.feature
│   ├── 13-error-handling.feature
│   ├── 14-demo-mode.feature
│   └── 15-technical-architecture.feature
└── data/                        # Created at runtime
    ├── vetted_portal.db         # SQLite database
    └── uploads/
        ├── library/             # User file uploads
        ├── projects/            # Project file uploads
        ├── avatars/             # Profile photos
        └── temp/                # Upload staging
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | `./data/vetted_portal.db` | SQLite database file path |
| `UPLOAD_DIR` | `./data/uploads` | Local file storage root |
| `MAX_FILE_SIZE_MB` | `50` | Maximum upload file size |
| `DEFAULT_MODEL` | `claude` | Default AI model selection |
| `DEMO_MODE` | `true` | Enable demo/mock mode |
| `SEED_DEMO_DATA` | `true` | Pre-seed database on first run |
| `PORT` | `3000` | Application server port |

## Getting Started

1. Review `15-technical-architecture.feature` for database schema and mock model setup
2. Review `14-demo-mode.feature` for the Play Demo walkthrough implementation
3. Use `10-ui-design-system.feature` as the source of truth for all visual styling
4. Reference the ASCII layout diagrams above for page structure
5. Set `DEMO_MODE=true` and `SEED_DEMO_DATA=true` for the demonstration build
6. Implement features in numerical order (auth → sidebar → chat → pipeline → projects → library → apps → admin → settings → UI → notifications → search → errors → demo → architecture)
