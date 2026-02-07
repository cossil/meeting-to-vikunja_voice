# Live Agent Audit Plan

**Date:** 2025-02-07
**Objective:** Document the exact current state of the Live Voice Agent into a single audit report: `Docs/audits/LIVE_AGENT_CURRENT_STATE.md`.
**Prerequisite:** The Standard Agent has been stabilized and its operational manual is complete (`Docs/specs/STANDARD_AGENT_OPERATIONAL_MANUAL.md`).

---

## 0. Critical Discovery: The Frontend Live Client Does Not Exist

During plan preparation, a full scan of `frontend/src/` revealed:

- **No `liveClient.ts`** — there is zero WebSocket client code in the frontend.
- **No `audioStreamer.ts`** — there is no streaming audio utility (no ScriptProcessorNode, no AudioWorklet, no raw PCM capture).
- **No live-specific Zustand store** — `useVoiceStore.ts` only handles the Standard Agent's HTTP turn-based flow.
- **The "Tempo Real" button in `VoiceAgentView.tsx` (line 36-39) is hardcoded as disabled** with the label `"Tempo Real (Em Breve)"` and class `cursor-not-allowed opacity-50`.

The **only** Live Agent code that exists is on the **backend**:
- `backend/app/api/endpoints/live.py` (10 lines — WebSocket endpoint)
- `backend/app/services/live_session.py` (147 lines — Gemini WS proxy)

The `full_duplex_voice_agent/` reference directory mentioned in prior memory **no longer exists** in the workspace.

This means the Live Agent is an **orphaned backend-only skeleton** with no frontend to drive it.

---

## 1. Architecture Determination

Based on the code read:

| Aspect | Current State |
|---|---|
| **Architecture** | Server-Side Proxy (Backend WS ↔ Gemini WS) |
| **Frontend Client** | **DOES NOT EXIST** |
| **Backend Endpoint** | `WS /api/v1/voice/live` (mounted in `main.py:29`) |
| **Backend Proxy** | `GeminiLiveSession` in `live_session.py` uses raw `websockets` library to connect to Gemini's `BidiGenerateContent` v1alpha WS API |
| **Gemini Model** | `gemini-2.0-flash-exp` (hardcoded in `live_session.py:36`) — **stale/deprecated model ID** |
| **Audio Format Expected** | Backend expects raw binary bytes from client, base64-encodes them, and sends as `audio/pcm` to Gemini (`live_session.py:87-88`) |
| **Audio Output** | Backend receives base64 audio from Gemini, decodes to raw bytes, sends as `send_bytes()` to client (`live_session.py:120`) |
| **Tool Calling** | `update_task_draft` function declaration defined (`live_session.py:13-31`), with tool response loop (`live_session.py:134-143`) |

---

## 2. Files & Functions to Inspect in the Full Audit

### Backend (EXISTS — the only Live code)

| File | Key Elements | Lines |
|---|---|---|
| `backend/app/api/endpoints/live.py` | `websocket_endpoint` — accepts WS, creates `GeminiLiveSession`, calls `session.start()` | 1-10 |
| `backend/app/services/live_session.py` | `GeminiLiveSession.__init__` — model ID, WS URI construction | 34-38 |
| | `GeminiLiveSession.start` — WS accept, setup message, handshake, bidirectional loop | 40-74 |
| | `client_to_google` — receives `data["bytes"]` or `data["text"]`, base64-encodes audio, sends `realtime_input` JSON | 76-101 |
| | `google_to_client` — parses Gemini JSON, forwards `inlineData` as raw bytes, handles `functionCall` for `update_task_draft` | 103-147 |
| | `update_task_draft_tool` — tool declaration dict | 13-31 |
| `backend/app/core/config.py` | `GOOGLE_API_KEY` used by live session | 1-14 |
| `backend/app/services/task_processor.py` | `get_system_prompt`, `GlossaryManager` — imported by live_session | (shared) |
| `backend/app/main.py` | Router mount: `live.router` at `/api/v1/voice` | 29 |

### Frontend (DOES NOT EXIST — document the gap)

| Expected File | Status |
|---|---|
| `frontend/src/api/liveClient.ts` | **Missing** — no WebSocket client |
| `frontend/src/utils/audioStreamer.ts` | **Missing** — no streaming audio capture |
| `frontend/src/store/useLiveStore.ts` | **Missing** — no live-specific state |
| `frontend/src/components/voice/VoiceControls.tsx` | Exists but has **zero live logic** — only Standard Agent MediaRecorder+Blob flow |
| `frontend/src/views/VoiceAgentView.tsx` | "Tempo Real" tab is **disabled placeholder** (line 36-39) |

---

## 3. Audit Goals Checklist

The audit report must answer each of these definitively:

| # | Question | Expected Finding |
|---|---|---|
| 1 | What is the architecture? | Server-Side Proxy (backend relays WS between client and Gemini) |
| 2 | What audio format does the backend expect from the client? | Raw binary bytes (PCM), base64-encoded before forwarding to Gemini as `audio/pcm` |
| 3 | What audio format does the backend send to the client? | Raw bytes (decoded from Gemini's base64 `inlineData`) via `send_bytes()` |
| 4 | What Gemini model is configured? | `gemini-2.0-flash-exp` — likely stale |
| 5 | What Gemini API version/endpoint is used? | `v1alpha` `BidiGenerateContent` via raw `websockets` library |
| 6 | Does a frontend client exist to connect to this backend? | **No** |
| 7 | Does streaming audio capture (PCM via ScriptProcessor/AudioWorklet) exist? | **No** |
| 8 | What tool declarations are registered? | `update_task_draft` with fields: title, description, assignee, dueDate, priority |
| 9 | Is the system prompt shared with the Standard Agent? | Yes — uses same `get_system_prompt()` from `task_processor.py` |
| 10 | What zombie/dead code exists? | The entire `live_session.py` is effectively zombie code (no frontend consumer) |

---

## 4. Proposed Audit Report Structure

**Output file:** `Docs/audits/LIVE_AGENT_CURRENT_STATE.md`

```
# Live Agent — Current State Audit

## 1. Executive Summary
   - One-paragraph status: backend-only skeleton, no frontend, non-functional.

## 2. Architecture Diagram
   - ASCII/Mermaid showing the INTENDED flow:
     Browser → WS → FastAPI → WS → Gemini BidiGenerateContent
   - Mark which segments exist and which are missing.

## 3. Backend: Endpoint Layer
   - `live.py` — verbatim analysis of the 10-line endpoint.
   - Router mount path and how it's registered.

## 4. Backend: Session Proxy (`live_session.py`)
   ### 4a. Initialization & Configuration
   - Model ID, WS URI, API key source.
   ### 4b. Setup Message
   - Full JSON structure sent to Gemini on connect.
   - System instruction source and content.
   - Tool declarations.
   ### 4c. Client → Google Relay (`client_to_google`)
   - Expected input format (binary vs text).
   - Base64 encoding step.
   - `realtime_input` JSON structure.
   ### 4d. Google → Client Relay (`google_to_client`)
   - Audio response handling (inlineData → send_bytes).
   - Tool call handling (functionCall → send_json → tool_response).
   ### 4e. Error Handling
   - Current exception handling (print + close).

## 5. Frontend: The Gap
   - List of expected but missing files.
   - Current UI state (disabled "Tempo Real" button).
   - No WebSocket client, no audio streaming, no live store.

## 6. Configurations Table
   - Quick-reference table of all hardcoded values with source file:line.

## 7. Zombie Code & Technical Debt
   - `live_session.py` is unreachable from any frontend path.
   - Model ID `gemini-2.0-flash-exp` is likely deprecated.
   - Uses raw `websockets` library instead of `google-genai` SDK.
   - No error recovery, no reconnection logic, no graceful shutdown.

## 8. Comparison Readiness Checklist
   - Table mapping each component to "exists / missing / stale"
   - This section primes the next phase: comparing against a working reference.
```

---

## 5. Execution Plan

| Step | Action | Output |
|---|---|---|
| 1 | ✅ Read all Live Agent source files | This plan |
| 2 | ✅ Discover that frontend Live client does not exist | Documented in Section 0 above |
| 3 | Create `Docs/audits/LIVE_AGENT_CURRENT_STATE.md` | Sections 1-8 populated with verbatim values |
| 4 | Embed the full setup message JSON and tool declaration as fenced code blocks | Exact copy from `live_session.py` |
| 5 | Embed the system prompt generation call and its parameters | Trace through `get_system_prompt` |
| 6 | Record all hardcoded values in the Configurations Table | Searchable quick-reference |
| 7 | Record the frontend gap as a structured checklist | Clear scope for Phase 5 (implementation) |
| 8 | Review with user before finalizing | Approval gate |

---

## 6. Key Risk: Stale Memory vs. Reality

Previous conversation memory references files that **no longer exist**:
- `frontend/src/api/liveClient.ts` — **not found**
- `frontend/src/utils/audioStreamer.ts` — **not found**
- `full_duplex_voice_agent/` directory — **not found**

These were likely from a previous iteration that was deleted or never committed. The audit must document **what exists now**, not what was once planned. Any comparison to a reference implementation will need that reference to be re-provided or re-created.
