# Project Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user opens a project, the right panel auto-opens showing that project's files; files uploaded inside a project are automatically assigned to it; the LLM always has those files as context.

**Architecture:** Add `projectFiles` state to the Zustand store. `ProjectDetailPage` fetches project files on load and opens the right panel if any exist. `RightPanel` detects the project route and renders "Project Files" (read-only) instead of "Attached Files" (per-message). `LibraryPickerModal` accepts an optional `projectId` prop that is included in uploads. `ChatInput` assigns selected files to the project when in project context.

**Tech Stack:** React, TypeScript, Zustand, existing REST API (`GET /api/library?project_id=`, `POST /api/library/upload`, `PUT /api/library/:id`)

---

### Task 1: Add `projectFiles` + `setRightPanelOpen` to the Zustand store

**Files:**
- Modify: `src/store/index.ts`

- [ ] **Step 1: Add `projectFiles` state and `setRightPanelOpen` action**

  In `src/store/index.ts`, add to the `AppState` interface (after `chatAttachedFiles` block):

  ```typescript
  projectFiles: LibraryFile[];
  setProjectFiles: (files: LibraryFile[]) => void;
  setRightPanelOpen: (open: boolean) => void;
  ```

- [ ] **Step 2: Add initial values and implementations**

  In the store initializer (after `addChatAttachedFile` line):

  ```typescript
  projectFiles: [],
  setProjectFiles: (files) => set({ projectFiles: files }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  ```

- [ ] **Step 3: Verify the app still compiles (no TypeScript errors)**

  Run: `npm run build 2>&1 | head -30`
  Expected: no new errors related to the store.

- [ ] **Step 4: Commit**

  ```bash
  git add src/store/index.ts
  git commit -m "feat: add projectFiles state and setRightPanelOpen to store"
  ```

---

### Task 2: Add `projectId` prop to `LibraryPickerModal` and pass it through uploads

**Files:**
- Modify: `src/components/chat/LibraryPickerModal.tsx`

The modal's `startUpload` function builds the FormData at line 220-222. It currently sends just `file`. We need to optionally append `project_id` when the modal is opened in project context.

- [ ] **Step 1: Add `projectId` to the props interface**

  In `LibraryPickerModalProps` (line 8-13), add:

  ```typescript
  export interface LibraryPickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAttach: (files: LibraryFile[]) => void;
    returnFocusRef: React.RefObject<HTMLButtonElement>;
    projectId?: string;
  }
  ```

- [ ] **Step 2: Accept and thread `projectId` through the component**

  Update the destructured props (line 29-34):

  ```typescript
  export default function LibraryPickerModal({
    isOpen,
    onClose,
    onAttach,
    returnFocusRef,
    projectId,
  }: LibraryPickerModalProps) {
  ```

- [ ] **Step 3: Pass `project_id` in FormData during upload**

  Update `startUpload`'s FormData block (lines 220-222):

  ```typescript
  const formData = new FormData();
  formData.append('file', file);
  if (projectId) formData.append('project_id', projectId);
  xhr.send(formData);
  ```

- [ ] **Step 4: Refresh `projectFiles` after upload completes in project context**

  Import `useStore` at the top of the file (it's not currently imported here — the modal is a pure component). Instead of importing the store, accept an optional `onUploadComplete` callback prop so the parent can react to uploads:

  Add to `LibraryPickerModalProps`:

  ```typescript
  onUploadComplete?: () => void;
  ```

  Accept it in the component destructuring:

  ```typescript
  export default function LibraryPickerModal({
    isOpen,
    onClose,
    onAttach,
    returnFocusRef,
    projectId,
    onUploadComplete,
  }: LibraryPickerModalProps) {
  ```

  In `xhr.onload` (line 192-211), after the `setTimeout` that switches back to browse view, call the callback:

  ```typescript
  setTimeout(() => {
    setFiles((prev) => [...prev, result]);
    setSelectedIds((prev) => new Set([...prev, result.id]));
    setView('browse');
    setTimeout(() => searchInputRef.current?.focus(), 0);
    if (projectId) onUploadComplete?.();
  }, 600);
  ```

  This ensures `projectFiles` in the panel refreshes as soon as an upload finishes, even if the user closes the modal without clicking "Add to Project".

- [ ] **Step 5: Change the footer button label in project context**

  The footer "Attach to Chat" button (line 354) should read "Add to Project" when in project context. Replace the button text:

  ```tsx
  <button
    disabled={selectedIds.size === 0}
    onClick={() => {
      onAttach(selectedFiles);
      handleClose();
    }}
    className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-opacity"
    style={{
      background: '#C4A962',
      color: '#fff',
      opacity: selectedIds.size === 0 ? 0.35 : 1,
      cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
    }}
  >
    {projectId ? 'Add to Project' : 'Attach to Chat'}
  </button>
  ```

  Pass `projectId` down to `BrowseView`'s footer by moving the footer into the main component (it is already there at line 335-369 — just update the button text inline as shown).

- [ ] **Step 6: Verify no TypeScript errors**

  Run: `npm run build 2>&1 | head -30`

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/chat/LibraryPickerModal.tsx
  git commit -m "feat: add projectId prop to LibraryPickerModal, refresh panel on upload, correct button label"
  ```

---

### Task 3: Pass `projectId` from `ChatInput` to `LibraryPickerModal` and assign selected files to project

**Files:**
- Modify: `src/components/chat/ChatInput.tsx`

`ChatInput` already receives `projectId?: string` as a prop and already opens `LibraryPickerModal`. The `onAttach` handler currently calls `setChatAttachedFiles(files)` + sends a hidden acknowledgment message. In project context we also need to assign each selected file to the project (for files that aren't already assigned) and refresh `projectFiles`.

- [ ] **Step 1: Pull `setProjectFiles` from the store in `ChatInput`**

  Add to the destructured store values (around line 31-38):

  ```typescript
  chatAttachedFiles, setChatAttachedFiles, setProjectFiles,
  ```

- [ ] **Step 2: Pass `projectId` and callbacks to `LibraryPickerModal`**

  In the `<LibraryPickerModal>` JSX (around line 174), add the props:

  ```typescript
  <LibraryPickerModal
    isOpen={isPickerOpen}
    onClose={() => setIsPickerOpen(false)}
    projectId={projectId}
    onUploadComplete={projectId ? async () => {
      const updated = await api.library.list(projectId);
      setProjectFiles(updated);
    } : undefined}
    onAttach={async (files) => {
      if (projectId) {
        // Assign any existing library files not yet in this project
        const unassigned = files.filter((f) => f.project_id !== projectId);
        await Promise.all(unassigned.map((f) => api.library.assignProject(f.id, projectId)));
        // Refresh project files in the panel
        const updated = await api.library.list(projectId);
        setProjectFiles(updated);
      } else {
        setChatAttachedFiles(files);
      }
      const count = files.length;
      const prompt = count === 1
        ? 'A file has been attached. Please briefly acknowledge it and let the user know you are ready to help with questions about it.'
        : `${count} files have been attached. Please briefly acknowledge them and let the user know you are ready to help with questions about them.`;
      handleSendMessage({ msg: prompt, files, hidden: true });
    }}
    returnFocusRef={paperclipButtonRef}
  />
  ```

  Note: In project context we do NOT call `setChatAttachedFiles` because project files are persistent context, not per-message attachments. The hidden message still informs the LLM about the newly added files. `onUploadComplete` handles the case where a user uploads a file then closes the modal without clicking "Add to Project".

- [ ] **Step 3: Verify no TypeScript errors**

  Run: `npm run build 2>&1 | head -30`

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/chat/ChatInput.tsx
  git commit -m "feat: assign uploaded files to project and refresh panel on attach"
  ```

---

### Task 4: Load project files in `ProjectDetailPage` and auto-open right panel

**Files:**
- Modify: `src/pages/ProjectDetailPage.tsx`

On project load, fetch `api.library.list(id)`, store results in `projectFiles`, and if any exist open the right panel.

- [ ] **Step 1: Pull `setProjectFiles` and `setRightPanelOpen` from the store**

  Update the destructured store values (line 15):

  ```typescript
  const { addToast, activeChat, setActiveChat, setProjectFiles, setRightPanelOpen } = useStore();
  ```

- [ ] **Step 2: Fetch project files after loading the project**

  Update `loadProject` to also fetch files:

  ```typescript
  const loadProject = async () => {
    try {
      const [proj, files] = await Promise.all([
        api.projects.get(id!),
        api.library.list(id!),
      ]);
      setProject(proj);
      setProjectFiles(files);
      if (files.length > 0) setRightPanelOpen(true);
    } catch {
      addToast({ type: 'error', title: 'Failed to load project' });
    } finally {
      setLoading(false);
    }
  };
  ```

- [ ] **Step 3: Clear project files and close panel when leaving the project**

  In the `useEffect` that runs on `id` change (line 22-27), also clear project files so they don't bleed into general chat. Close the panel on unmount so it doesn't stay open when navigating back to general chat.

  ```typescript
  useEffect(() => {
    if (id) {
      setActiveChat(null);
      setProjectFiles([]);
      loadProject();
    }
    return () => {
      setProjectFiles([]);
      setRightPanelOpen(false);
    };
  }, [id]);
  ```

- [ ] **Step 4: Verify no TypeScript errors**

  Run: `npm run build 2>&1 | head -30`

- [ ] **Step 5: Commit**

  ```bash
  git add src/pages/ProjectDetailPage.tsx
  git commit -m "feat: load project files on project open and auto-open right panel"
  ```

---

### Task 5: Update `RightPanel` to show "Project Files" on project routes

**Files:**
- Modify: `src/components/RightPanel.tsx`

When the current path starts with `/projects/`, show `projectFiles` with the label "Project Files" and no remove buttons. On all other routes keep the existing "Attached Files" + remove behavior.

- [ ] **Step 1: Pull `projectFiles` from the store**

  Update the destructured store values (line 9):

  ```typescript
  const {
    rightPanelOpen, toggleRightPanel,
    chatAttachedFiles, setChatAttachedFiles,
    projectFiles,
  } = useStore();
  ```

- [ ] **Step 2: Detect project context and branch the render**

  Replace the panel body (everything inside the `rightPanelOpen && (...)` block, starting at line 29) with:

  ```tsx
  {rightPanelOpen && (
    <div className="w-56 border-l border-vetted-border flex flex-col bg-white">
      {isProjectRoute ? (
        <>
          <div className="px-3 py-2.5 border-b border-vetted-border">
            <span className="text-[11px] font-semibold text-vetted-text-muted uppercase tracking-wider">
              Project Files
              {projectFiles.length > 0 && (
                <span className="ml-1.5 text-vetted-accent">{projectFiles.length}</span>
              )}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {projectFiles.length === 0 ? (
              <div className="flex items-center justify-center h-24 px-4 text-center">
                <p className="text-[11px] text-vetted-text-muted">No files in this project</p>
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {projectFiles.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-vetted-surface"
                  >
                    <FileTypeBadge fileType={f.file_type} size={16} />
                    <span className="text-[12px] text-vetted-primary flex-1 truncate leading-tight">
                      {f.original_name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="px-3 py-2.5 border-b border-vetted-border">
            <span className="text-[11px] font-semibold text-vetted-text-muted uppercase tracking-wider">
              Attached Files
              {chatAttachedFiles.length > 0 && (
                <span className="ml-1.5 text-vetted-accent">{chatAttachedFiles.length}</span>
              )}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {chatAttachedFiles.length === 0 ? (
              <div className="flex items-center justify-center h-24 px-4 text-center">
                <p className="text-[11px] text-vetted-text-muted">No files attached</p>
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {chatAttachedFiles.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-vetted-surface"
                  >
                    <FileTypeBadge fileType={f.file_type} size={16} />
                    <span className="text-[12px] text-vetted-primary flex-1 truncate leading-tight">
                      {f.original_name}
                    </span>
                    <button
                      onClick={() =>
                        setChatAttachedFiles(chatAttachedFiles.filter((cf) => cf.id !== f.id))
                      }
                      className="p-0.5 text-vetted-text-muted hover:text-vetted-danger transition-colors shrink-0"
                      title="Remove"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )}
  ```

- [ ] **Step 3: Add `isProjectRoute` variable near the top of the component**

  After `const isVisible = ...`:

  ```typescript
  const isProjectRoute = location.pathname.startsWith('/projects/');
  ```

- [ ] **Step 4: Verify no TypeScript errors**

  Run: `npm run build 2>&1 | head -30`

- [ ] **Step 5: Manual smoke test**

  1. Open a project that has files → right panel opens, shows "Project Files" with the file list
  2. Open a project with no files → right panel stays closed
  3. Navigate to general chat → right panel shows "Attached Files" with remove buttons
  4. Upload a file inside a project → file appears in the "Project Files" panel
  5. Select an existing library file inside a project → it gets assigned to the project and appears in the panel

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/RightPanel.tsx
  git commit -m "feat: show Project Files panel in project context, Attached Files elsewhere"
  ```
