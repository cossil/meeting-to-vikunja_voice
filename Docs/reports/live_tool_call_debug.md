# Live Agent Tool Call Debug Report

**Date:** 2025-02-07
**Status:** ROOT CAUSE FOUND & FIXED
**Symptom:** Live Agent audio/conversation works, model identifies task fields, but Task Draft UI never updates.

---

## Trace Summary

| Layer | File | Verdict |
|---|---|---|
| **Backend** | `backend/app/services/live_session.py` | ❌ **BUG HERE** — tool calls silently swallowed |
| Frontend Network | `frontend/src/api/liveClient.ts` | ✅ Correct — `case 'task_update'` routes to `onTaskUpdate` |
| Frontend Store | `frontend/src/store/useLiveStore.ts` | ✅ Correct — `onTaskUpdate` merges into `currentTask` |

---

## Root Cause: Gemini Live API Message Structure Mismatch

### The Problem

The Gemini Live API (`BidiGenerateContent`) uses a **union message type** for server messages. Tool calls arrive as a **top-level `toolCall` field**, NOT nested inside `serverContent.modelTurn.parts[]`.

**Actual Gemini Live API response for tool calls:**
```json
{
  "toolCall": {
    "functionCalls": [
      {
        "id": "fc_abc123",
        "name": "update_task_draft",
        "args": { "title": "Revisar relatório", "priority": 3 }
      }
    ]
  }
}
```

**What the backend expected (WRONG — this is the unary/streaming API format):**
```json
{
  "serverContent": {
    "modelTurn": {
      "parts": [
        {
          "functionCall": {
            "name": "update_task_draft",
            "args": { ... },
            "id": "..."
          }
        }
      ]
    }
  }
}
```

### The Fatal Line

```python
# live_session.py:166-168 (BEFORE fix)
server_content = msg.get("serverContent")
if not server_content:
    continue  # ← SILENTLY SKIPS toolCall messages!
```

When Gemini sends a `toolCall` message, it has **no `serverContent` field**. The `continue` statement discards the entire message without logging or processing.

### Secondary Bug: Tool Response Format

The old code also had the wrong tool response format:

**Old (wrong):**
```python
{"tool_response": {"function_responses": [{"name": ..., "response": {"status": "ok", "ack": True}, "id": ...}]}}
```

**Correct (per API spec):**
```python
{"tool_response": {"function_responses": [{"id": ..., "name": ..., "response": {"result": "ok"}}]}}
```

Key differences:
- `id` must come from `toolCall.functionCalls[].id` (not from a non-existent `functionCall.id` path)
- Response uses `{"result": "ok"}` format (per official examples)

---

## Fix Applied

**File:** `backend/app/services/live_session.py` — `google_to_client()` method

### Changes:

1. **Added top-level `toolCall` handling BEFORE the `serverContent` check:**
   - Iterates `toolCall.functionCalls[]`
   - Forwards `update_task_draft` args to client as `{"type": "task_update", "data": {...}}`
   - Sends correct tool response with `id`, `name`, `response.result`
   - Logs tool call details for debugging
   - Uses `continue` after processing to skip `serverContent` check

2. **Added `toolCallCancellation` handling:**
   - Logs cancelled tool call IDs
   - Gracefully skips (no client notification needed)

3. **Removed dead code:**
   - Removed the old `functionCall` handling from inside `serverContent.modelTurn.parts[]` (that path never fires in the Live API)

### Message Processing Order (after fix):

```
msg received from Gemini
  ├── toolCall?          → forward to client + acknowledge → continue
  ├── toolCallCancellation? → log → continue
  ├── serverContent?
  │   ├── modelTurn.parts[].inlineData → send binary audio
  │   ├── inputTranscription → send transcript event
  │   ├── outputTranscription → send transcript event
  │   ├── turnComplete → send turn_complete event
  │   └── interrupted → send interrupted event
  └── (other: setupComplete, goAway, etc.) → skip
```

---

## Frontend Verification (No Changes Needed)

### liveClient.ts (lines 112-114)
```typescript
case 'task_update':
  handlers.onTaskUpdate(msg.data);  // ✅ Routes correctly
  break;
```

### useLiveStore.ts (lines 132-144)
```typescript
onTaskUpdate: (data) => {
  set((state) => ({
    currentTask: {
      ...state.currentTask,
      title: data.title ?? state.currentTask.title,       // ✅ Merges correctly
      description: data.description ?? state.currentTask.description,
      dueDate: data.dueDate ?? state.currentTask.dueDate,
      assignee: data.assignee ?? state.currentTask.assignee,
      priority: data.priority ?? state.currentTask.priority,
      status: 'draft',
    },
  }));
},
```

---

## Data Flow (After Fix)

```
Gemini API
  │ {"toolCall": {"functionCalls": [{"id":"x","name":"update_task_draft","args":{...}}]}}
  ▼
live_session.py (google_to_client)
  │ 1. Extract fn_name, fn_args, fn_id
  │ 2. send_json({"type":"task_update","data": fn_args})  → to client
  │ 3. send tool_response({"id":"x","name":"...","response":{"result":"ok"}})  → to Gemini
  ▼
liveClient.ts (onmessage)
  │ case 'task_update' → handlers.onTaskUpdate(msg.data)
  ▼
useLiveStore.ts (onTaskUpdate handler)
  │ set({ currentTask: { ...merged fields } })
  ▼
LiveTaskDraftCard.tsx (reactive render)
  │ Displays updated title, description, assignee, dueDate, priority
```

---

## Isolation Guarantee

| Constraint | Status |
|---|---|
| Standard Agent files untouched | ✅ |
| `useVoiceStore.ts` untouched | ✅ |
| `voice_service.py` untouched | ✅ |
| Fix scoped to `live_session.py` only | ✅ |
| Frontend required zero changes | ✅ |
