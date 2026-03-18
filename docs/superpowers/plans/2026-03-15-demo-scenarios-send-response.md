# Demo Scenarios — Send & Response Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend both demo scenarios to actually send the message (after model selection) and let the real mock AI response render naturally in the chat view.

**Architecture:** Add a `demoTriggerSend` boolean to the Zustand store. `ChatInput` watches it and fires `handleSendMessage()` when it becomes `true`, then clears the flag. The two scenario step arrays in `DemoMode.tsx` are updated to include model-selection and a send-trigger step. The response then loads naturally via the existing backend mock path.

**Tech Stack:** React, TypeScript, Zustand, React Router v6, Express/SQLite backend (mock responses via `DEMO_MODE=true`)

---

## Chunk 1: Store — add `demoTriggerSend`

### Task 1: Add `demoTriggerSend` to Zustand store

**Files:**
- Modify: `src/store/index.ts:33-111`

- [ ] **Step 1: Add the type to the `AppState` interface**

In `src/store/index.ts`, in the `// Demo mode` block of the interface (after line 47), add:

```ts
demoTriggerSend: boolean;
setDemoTriggerSend: (v: boolean) => void;
```

- [ ] **Step 2: Add the initial value and setter in the store body**

In the `// Demo` block of the `create(...)` call (after line 111), add:

```ts
demoTriggerSend: false,
setDemoTriggerSend: (v) => set({ demoTriggerSend: v }),
```

- [ ] **Step 3: Reset `demoTriggerSend` in `setDemoActive`**

The existing `setDemoActive` setter (lines 97-105) already resets all demo state. Add `demoTriggerSend: false` to that reset object:

```ts
setDemoActive: (v) => set({
  demoActive: v,
  demoStep: 0,
  demoPaused: false,
  demoHighlight: null,
  demoInputText: '',
  demoShowModelPicker: false,
  demoAttachedFile: null,
  demoTriggerSend: false,   // ← add this line
}),
```

- [ ] **Step 4: Verify the app still compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/index.ts
git commit -m "feat(demo): add demoTriggerSend to store"
```

---

## Chunk 2: ChatInput — watch `demoTriggerSend` and fire send

### Task 2: Wire `demoTriggerSend` into `ChatInput`

**Files:**
- Modify: `src/components/chat/ChatInput.tsx:42-118`

- [ ] **Step 1: Destructure `demoTriggerSend` and `setDemoTriggerSend` from the store**

In the `useStore()` destructure block (around line 46-48), add the two new fields:

```ts
const {
  activeChat, setActiveChat, addToast,
  demoActive, demoHighlight, demoInputText, demoShowModelPicker, demoAttachedFile,
  demoTriggerSend, setDemoTriggerSend,   // ← add this line
} = useStore();
```

- [ ] **Step 2: Add a `useEffect` that watches `demoTriggerSend`**

Add this effect after the existing demo sync effects (after line 66):

```ts
useEffect(() => {
  if (demoActive && demoTriggerSend) {
    setDemoTriggerSend(false);
    handleSendMessage();
  }
}, [demoActive, demoTriggerSend]);
```

> **Note:** `handleSendMessage` is defined later in the same component. Because this effect only runs on state changes (not at definition time), the closure captures the current version of `handleSendMessage` at the time the effect fires — this works correctly with the current component structure.

- [ ] **Step 3: Verify the app still compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatInput.tsx
git commit -m "feat(demo): fire handleSendMessage when demoTriggerSend is set"
```

---

## Chunk 3: DemoMode — update scenario steps

### Task 3: Rewrite Scenario 1 ("Make a Request") steps

**Files:**
- Modify: `src/components/demo/DemoMode.tsx:36-65`

Replace the existing 3-step array for scenario 1 with these 4 steps:

```ts
steps: [
  {
    description: 'Type your request in the chat input below',
    highlight: 'chat-input',
    action: () => {
      navigate('/');
      setDemoInputText('Summarize the key risks in our Q4 earnings report');
      setDemoShowModelPicker(false);
      setDemoAttachedFile(null);
      setDemoTriggerSend(false);
    },
    duration: 3000,
  },
  {
    description: 'Choose your AI model — Claude, Gemini, and more are available',
    highlight: 'model-picker',
    action: () => {
      setDemoShowModelPicker(true);
    },
    duration: 3000,
  },
  {
    description: 'Sonnet 4.6 selected — ready to send',
    highlight: 'send-button',
    action: () => {
      setDemoShowModelPicker(false);
    },
    duration: 2000,
  },
  {
    description: 'Sending your request — watch the response appear below',
    highlight: null,
    action: () => {
      setDemoTriggerSend(true);
    },
    duration: 3500,
  },
],
```

- [ ] **Step 1: Destructure `setDemoTriggerSend` in `DemoMode.tsx`**

In the `useStore()` destructure block at the top of `DemoMode` (lines 15-24), add `setDemoTriggerSend`:

```ts
const {
  demoActive,
  setDemoActive,
  demoPaused,
  setDemoPaused,
  setDemoHighlight,
  setDemoInputText,
  setDemoShowModelPicker,
  setDemoAttachedFile,
  setDemoTriggerSend,   // ← add this line
} = useStore();
```

- [ ] **Step 2: Replace the scenario 1 steps array** with the 4-step version above.

- [ ] **Step 3: Also clear `demoTriggerSend` in `handleExit`**

`handleExit` (line 143) resets all demo UI state. Add the reset there too:

```ts
const handleExit = () => {
  setDemoActive(false);     // already resets demoTriggerSend via setDemoActive
  setActiveScenario(null);
  setCurrentStep(0);
  setDone(false);
  setDemoPaused(false);
};
```

`setDemoActive(false)` already resets `demoTriggerSend` (from Task 1, Step 3) so no additional line is needed here. Just verify this is the case.

- [ ] **Step 4: Verify the app still compiles**

```bash
npm run build 2>&1 | tail -20
```

### Task 4: Rewrite Scenario 2 ("Ask About a File") steps

**Files:**
- Modify: `src/components/demo/DemoMode.tsx:66-104`

Replace the existing 4-step array for scenario 2 with these 4 steps:

```ts
steps: [
  {
    description: 'Click the paperclip to attach a file from your library',
    highlight: 'paperclip',
    action: () => {
      navigate('/');
      setDemoInputText('');
      setDemoAttachedFile('Q4_Earnings_Report.pdf');
      setDemoShowModelPicker(false);
      setDemoTriggerSend(false);
    },
    duration: 3000,
  },
  {
    description: 'Ask a question about the document',
    highlight: 'chat-input',
    action: () => {
      setDemoInputText('What are the key findings in this document?');
    },
    duration: 3000,
  },
  {
    description: 'Your file is attached and ready — sending now',
    highlight: 'send-button',
    action: () => {},
    duration: 2000,
  },
  {
    description: 'Sending your request — watch the response appear below',
    highlight: null,
    action: () => {
      setDemoTriggerSend(true);
    },
    duration: 3500,
  },
],
```

- [ ] **Step 1: Replace the scenario 2 steps array** with the 4-step version above.

- [ ] **Step 2: Verify the app still compiles**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 3: Commit both scenario changes together**

```bash
git add src/components/demo/DemoMode.tsx
git commit -m "feat(demo): scenarios 1 & 2 now select model, send, and show response"
```

---

## Chunk 4: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Log in and open demo mode**

Log in as `james.wilson@company.com`. Click the demo trigger (wherever it's exposed in the UI — check `App.tsx` or the sidebar for the `<DemoMode />` component and how it's activated).

- [ ] **Step 3: Run Scenario 1 end-to-end**

1. Select "Make a Request"
2. Watch: input fills → model picker opens → model picker closes → send fires
3. App navigates to `/chat/:id`
4. Mock AI response appears in the chat view
5. Demo panel shows "Done!" with Replay / Scenarios buttons

- [ ] **Step 4: Run Scenario 2 end-to-end**

1. Select "Ask About a File"
2. Watch: file chip appears → input fills → send fires
3. App navigates to `/chat/:id`, response appears
4. Demo panel shows "Done!"

- [ ] **Step 5: Verify exit / replay works cleanly**

After a scenario completes, click Replay — confirm it resets cleanly and runs again without double-firing the send. Click Exit — confirm no lingering demo state.
