# Live Agent — Current State Audit

**Date:** 2025-02-07
**Auditor:** ACA (Cascade)
**Source Plan:** `Docs/plans/live_agent_audit_plan.md`
**Companion Document:** `Docs/specs/STANDARD_AGENT_OPERATIONAL_MANUAL.md` (Standard Agent reference)

---

## 1. Executive Summary

The Live Voice Agent is a **non-functional, backend-only skeleton**. The backend implements a WebSocket proxy (`GeminiLiveSession`) that relays audio between a browser client and Google's `BidiGenerateContent` streaming API. However, **no frontend code exists to connect to it** — no WebSocket client, no streaming audio capture, no live-specific state management. The "Tempo Real" button in the UI is a disabled placeholder. The backend uses a **stale model ID** (`gemini-2.0-flash-exp`) and the raw `websockets` Python library instead of the `google-genai` SDK. The entire Live stack is effectively orphaned dead code.

**Verdict:** The Live Agent must be built from scratch on the frontend. The backend skeleton provides a reasonable architectural starting point (server-side proxy pattern) but requires significant updates to model ID, error handling, and SDK usage before it can function.

---

## 2. Architecture Diagram

### Intended Flow (What Was Designed)

```
┌──────────────────────────────────────────────────────────────────────┐
│                        INTENDED ARCHITECTURE                         │
│                                                                      │
│  ┌─────────┐    WS (binary PCM)    ┌──────────┐    WS (JSON+b64)     │
│  │ Browser │ ──────────────────►   │ FastAPI  │ ──────────────────►  │
│  │ (Client)│                       │ Backend  │                      │
│  │         │ ◄──────────────────   │ (Proxy)  │ ◄──────────────────  │
│  └─────────┘    WS (raw bytes)     └──────────┘    WS (JSON+b64)   │
│       │                                  │                    │      │
│       │                                  │              ┌─────┴────┐ │
│       │                                  │              │  Gemini  │ │
│       │                                  │              │  v1alpha │ │
│       │                                  │              │  BidiGen │ │
│       │                                  │              └──────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Actual State (What Exists)

```
┌──────────────────────────────────────────────────────────────────────┐
│                          ACTUAL STATE                                │
│                                                                      │
│  ┌─────────┐                        ┌──────────┐    WS (JSON+b64)    │
│  │ Browser │    ❌ MISSING ❌      │ FastAPI  │ ──────────────────► │
│  │ (Client)│    No WS client        │ Backend  │                     │
│  │         │    No audio stream     │ (Proxy)  │ ◄────────────────── │
│  └─────────┘    No live store       └──────────┘    WS (JSON+b64)    │
│       │                                  │                    │      │
│       │  Only has disabled               │              ┌─────┴────┐ │
│       │  "Tempo Real (Em Breve)"         │              │  Gemini  │ │
│       │  button placeholder              │              │  v1alpha │ │
│       │                                  │              │  BidiGen │ │
│       │                                  │              └──────────┘ │
│       │                                                              │
│  ┌────┴─────────────────────────────────────────────────────────┐    │
│  │  EXISTING FRONTEND: Only Standard Agent (HTTP turn-based)    │    │
│  │  VoiceControls.tsx → MediaRecorder → Blob → POST /voice/turn │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Backend: Endpoint Layer

**Source:** `backend/app/api/endpoints/live.py` (10 lines)

### Full File Content (Verbatim)

```python
from fastapi import APIRouter, WebSocket
from app.services.live_session import GeminiLiveSession

router = APIRouter()

@router.websocket("/live")
async def websocket_endpoint(websocket: WebSocket):
    session = GeminiLiveSession()
    await session.start(websocket)
```

### Analysis

| Aspect | Value |
|---|---|
| **Router type** | `APIRouter()` |
| **Route** | `@router.websocket("/live")` |
| **Mount point** | `app.include_router(live.router, prefix="/api/v1/voice", tags=["Voice (Live)"])` in `main.py:29` |
| **Full URL** | `ws://localhost:8000/api/v1/voice/live` |
| **Session creation** | New `GeminiLiveSession()` instance per connection (no pooling, no auth) |
| **Error handling** | None at endpoint level — delegated entirely to `session.start()` |
| **Authentication** | None — any client can connect |
| **Rate limiting** | None |

---

## 4. Backend: Session Proxy (`live_session.py`)

**Source:** `backend/app/services/live_session.py` (147 lines)

### 4a. Initialization & Configuration

```python
class GeminiLiveSession:
    def __init__(self):
        self.api_key = settings.GOOGLE_API_KEY
        self.model = "gemini-2.0-flash-exp"
        self.host = "generativelanguage.googleapis.com"
        self.uri = f"wss://{self.host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key={self.api_key}"
```

| Configuration | Value | Source Line |
|---|---|---|
| **Model ID** | `gemini-2.0-flash-exp` | `live_session.py:36` |
| **API Version** | `v1alpha` | `live_session.py:38` |
| **WS Host** | `generativelanguage.googleapis.com` | `live_session.py:37` |
| **WS Protocol** | `wss://` (TLS) | `live_session.py:38` |
| **Auth Method** | API key as query parameter (`?key=`) | `live_session.py:38` |
| **WS Library** | `websockets` (raw, not `google-genai` SDK) | `live_session.py:3` |
| **API Key Source** | `settings.GOOGLE_API_KEY` from `config.py` | `live_session.py:35` |

**⚠ Model ID `gemini-2.0-flash-exp` is likely stale/deprecated.** The Standard Agent uses `gemini-3-flash-preview` for NLU. The Live Agent should use a model that supports the `BidiGenerateContent` streaming API (e.g., `gemini-2.5-flash-native-audio-preview` or similar).

### 4b. Setup Message

Sent to Gemini immediately after WebSocket connection:

```python
setup_msg = {
    "setup": {
        "model": f"models/{self.model}",           # "models/gemini-2.0-flash-exp"
        "tools": [update_task_draft_tool],           # Function calling tool
        "system_instruction": {
            "parts": [{"text": system_instruction}]  # From get_system_prompt()
        }
    }
}
await google_ws.send(json.dumps(setup_msg))
```

**System Instruction Source:** Calls `get_system_prompt(meeting_date, "Voice Interaction Mode", glossary_rules)` from `task_processor.py:57-83`.

This is the **same** system prompt used by the Batch Processing pipeline — it is designed for meeting transcription analysis, NOT for a conversational voice agent. The Standard Agent has its own dedicated `SYSTEM_INSTRUCTION` in `voice_service.py`. This is a **significant mismatch**: the Live Agent is using a batch-processing prompt for a real-time conversational interaction.

**Full system prompt template** (from `task_processor.py:58-83`):

```
Você é um Analista Sênior de Projetos e Atas.
Sua missão é transformar uma transcrição crua (que pode ser a união de vários
arquivos de áudio contendo erros de digitação, gírias e conversas paralelas)
em tarefas profissionais e acionáveis.

CONTEXTO DE ENTRADA:
1. Data da Reunião: {meeting_date_str}
2. Instruções do Usuário: "Voice Interaction Mode"
3. Origem: Consolidação de segmentos da MESMA reunião.

DIRETRIZES DE PROCESSAMENTO (PRIORIDADE MÁXIMA = EXAUSTIVIDADE):
1. FILTRO DE RUÍDO: Identifique e exclua agressivamente vícios de linguagem...
2. NORMALIZAÇÃO 1: Corrija a gramática do STT...
3. NORMALIZAÇÃO 2: Use as regras do glossário abaixo para corrigir nomes...
{glossary_rules}
4. TAREFAS IMPLÍCITAS: Identifique compromissos ocultos...
5. EXAUSTIVIDADE (CRÍTICO): Não deixe NENHUMA tarefa para trás...
6. CONSOLIDAÇÃO INTELIGENTE: Identifique itens sobrepostos...
7. CONTINUIDADE: Trate o texto como um fluxo contínuo...

FORMATO DE SAÍDA (JSON):
- title (string): Verbo + Objeto
- description (string): Contexto completo
- assignee_name (string): Nome corrigido
- priority (int): 1-5
- due_date (string): YYYY-MM-DD ou null
```

### 4c. Tool Declaration

```python
update_task_draft_tool = {
    "function_declarations": [
        {
            "name": "update_task_draft",
            "description": "Updates the current draft of the task based on user voice input.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "title":       {"type": "STRING", "description": "The title of the task."},
                    "description": {"type": "STRING", "description": "The description or notes for the task."},
                    "assignee":    {"type": "STRING", "description": "Who is responsible for the task."},
                    "dueDate":     {"type": "STRING", "description": "Due date in YYYY-MM-DD format."},
                    "priority":    {"type": "INTEGER", "description": "Priority from 1 (Low) to 5 (Critical)."}
                },
                "required": ["title"]
            }
        }
    ]
}
```

| Field | Type | Required |
|---|---|---|
| `title` | STRING | Yes |
| `description` | STRING | No |
| `assignee` | STRING | No |
| `dueDate` | STRING | No |
| `priority` | INTEGER | No |

### 4d. Client → Google Relay (`client_to_google`)

**Source:** `live_session.py:76-101`

```python
async def client_to_google(self, client_ws, google_ws):
    try:
        while True:
            data = await client_ws.receive()

            if "bytes" in data:
                # Forward audio as base64-encoded PCM
                realtime_input = {
                    "realtime_input": {
                        "media_chunks": [{
                            "mime_type": "audio/pcm",
                            "data": base64.b64encode(data["bytes"]).decode("utf-8")
                        }]
                    }
                }
                await google_ws.send(json.dumps(realtime_input))

            elif "text" in data:
                # Handle text control messages if needed (e.g. stop generation)
                pass  # ← Currently a no-op

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error reading from client: {e}")
```

| Aspect | Value |
|---|---|
| **Expected client input** | Raw binary bytes via `client_ws.receive()` checking `data["bytes"]` |
| **Audio MIME type sent to Gemini** | `audio/pcm` |
| **Encoding** | `base64.b64encode()` before sending |
| **Gemini message format** | `realtime_input.media_chunks[]` |
| **Text message handling** | `pass` — completely ignored |
| **Error handling** | `print()` only — no cleanup, no reconnection |

### 4e. Google → Client Relay (`google_to_client`)

**Source:** `live_session.py:103-147`

```python
async def google_to_client(self, google_ws, client_ws):
    try:
        async for raw_msg in google_ws:
            msg = json.loads(raw_msg)

            server_content = msg.get("serverContent")
            if server_content:
                model_turn = server_content.get("modelTurn")
                if model_turn:
                    parts = model_turn.get("parts", [])
                    for part in parts:

                        # Audio Response
                        if "inlineData" in part:
                            audio_b64 = part["inlineData"]["data"]
                            await client_ws.send_bytes(base64.b64decode(audio_b64))

                        # Tool Call
                        if "functionCall" in part:
                            fn = part["functionCall"]
                            if fn["name"] == "update_task_draft":
                                args = fn["args"]
                                await client_ws.send_json({
                                    "type": "task_update",
                                    "data": args
                                })
                                # Respond to tool call
                                tool_response = {
                                    "tool_response": {
                                        "function_responses": [{
                                            "name": "update_task_draft",
                                            "response": {"status": "ok", "ack": True},
                                            "id": fn.get("id", "unk")
                                        }]
                                    }
                                }
                                await google_ws.send(json.dumps(tool_response))

    except Exception as e:
        print(f"Error reading from Google: {e}")
```

| Aspect | Value |
|---|---|
| **Audio output to client** | Raw bytes via `client_ws.send_bytes(base64.b64decode(...))` |
| **Audio format** | Whatever Gemini returns (likely raw PCM, no WAV header) |
| **Tool call detection** | Checks `part["functionCall"]` |
| **Tool call forwarding** | Sends JSON `{"type": "task_update", "data": args}` to client via `send_json()` |
| **Tool response** | Sends `tool_response` back to Gemini to continue the turn |
| **Mixed message types** | Client receives BOTH binary (audio) and JSON (tool calls) on the same WS — frontend must distinguish |
| **Error handling** | `print()` only |

### 4f. Session Lifecycle (`start`)

**Source:** `live_session.py:40-74`

```python
async def start(self, client_ws: WebSocket):
    await client_ws.accept()

    # Prepare System Prompt
    glossary_rules = GLOSSARY.get_prompt_rules()
    meeting_date = datetime.now().strftime('%d/%m/%Y')
    system_instruction = get_system_prompt(meeting_date, "Voice Interaction Mode", glossary_rules)

    try:
        async with websockets.connect(self.uri) as google_ws:
            # 1. Send Setup Message
            setup_msg = { ... }
            await google_ws.send(json.dumps(setup_msg))

            # 2. Handshake response
            first_msg = await google_ws.recv()

            # 3. Bidirectional Loop
            await asyncio.gather(
                self.client_to_google(client_ws, google_ws),
                self.google_to_client(google_ws, client_ws)
            )
    except Exception as e:
        print(f"Session Error: {e}")
        await client_ws.close()
```

| Aspect | Value |
|---|---|
| **Client WS accept** | Immediate, no auth check |
| **Glossary** | Module-level singleton `GLOSSARY = GlossaryManager()` at `live_session.py:10` |
| **Handshake** | Receives first message from Gemini but discards it (commented-out debug print) |
| **Concurrency** | `asyncio.gather()` runs both relay loops in parallel |
| **Shutdown** | If either relay throws, the `gather` propagates; outer `except` prints and closes client WS |
| **Gemini WS cleanup** | Handled by `async with` context manager |

---

## 5. Frontend: The Gap

### 5a. Missing Files (Confirmed)

A full recursive scan of `frontend/src/` confirms these files **do not exist**:

| Expected File | Purpose | Status |
|---|---|---|
| `frontend/src/api/liveClient.ts` | WebSocket client to connect to `ws://localhost:8000/api/v1/voice/live` | **MISSING** |
| `frontend/src/utils/audioStreamer.ts` | Streaming audio capture (ScriptProcessorNode or AudioWorklet for raw PCM) | **MISSING** |
| `frontend/src/store/useLiveStore.ts` | Zustand store for live session state (connection status, streaming audio, task updates) | **MISSING** |

### 5b. Disabled UI Placeholder

**Source:** `frontend/src/views/VoiceAgentView.tsx:31-39`

```tsx
<div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-full p-1 pl-3 pr-1">
    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Padrão (Ativo)</span>
    <Button
        variant="secondary"
        size="sm"
        className="h-7 rounded-full text-xs font-bold gap-1 shadow-sm opacity-50 cursor-not-allowed"
    >
        <AudioWaveform className="w-3 h-3" /> Tempo Real (Em Breve)
    </Button>
</div>
```

| Aspect | Value |
|---|---|
| **Button state** | Visually disabled via CSS (`opacity-50 cursor-not-allowed`) but **not** using the `disabled` HTML attribute |
| **No `onClick` handler** | The button has no click handler — it is purely decorative |
| **No tab switching logic** | There is no state variable, no conditional rendering, no mode toggle |
| **Label** | "Tempo Real (Em Breve)" — "Real Time (Coming Soon)" |

### 5c. VoiceControls.tsx — Zero Live Logic

**Source:** `frontend/src/components/voice/VoiceControls.tsx` (107 lines)

This component handles **only** the Standard Agent flow:
- `MediaRecorder` → Blob chunks → `processUserAudio(audioBlob)` → HTTP `POST /voice/turn`
- Text input → `sendTextMessage(text)` → HTTP `POST /voice/turn`
- No WebSocket references, no streaming audio, no live mode conditional

### 5d. useVoiceStore.ts — Standard Agent Only

**Source:** `frontend/src/store/useVoiceStore.ts` (197 lines)

- Imports only `voiceApi` (HTTP-based)
- No WebSocket state (`isConnected`, `wsRef`, etc.)
- No streaming audio state
- `processUserAudio` sends Blob via `voiceApi.sendTurn()` (HTTP POST)
- No `startLiveSession()` / `stopLiveSession()` actions

### 5e. AudioRecorder.tsx — Duplicate Dead Code

**Source:** `frontend/src/components/voice/AudioRecorder.tsx` (72 lines)

This is an **older duplicate** of the recording logic now in `VoiceControls.tsx`. It is not imported or used anywhere in the current UI. It is zombie code from a previous iteration.

**Evidence it's unused:** `VoiceAgentView.tsx` imports `VoiceControls` (not `AudioRecorder`). No other file imports `AudioRecorder`.

---

## 6. Configurations Table

| # | Configuration | Current Value | Source |
|---|---|---|---|
| 1 | **Gemini Model ID** | `gemini-2.0-flash-exp` | `live_session.py:36` |
| 2 | **Gemini API Version** | `v1alpha` | `live_session.py:38` |
| 3 | **WS Endpoint** | `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent` | `live_session.py:38` |
| 4 | **Auth Method** | API key as `?key=` query param | `live_session.py:38` |
| 5 | **WS Library** | `websockets` (Python, raw) | `live_session.py:3` |
| 6 | **Audio MIME to Gemini** | `audio/pcm` | `live_session.py:87` |
| 7 | **Audio Input Expected** | Raw binary bytes from client WS | `live_session.py:82` |
| 8 | **Audio Output to Client** | Raw bytes via `send_bytes()` | `live_session.py:120` |
| 9 | **System Prompt Source** | `get_system_prompt()` from `task_processor.py` (batch-processing prompt) | `live_session.py:46` |
| 10 | **System Prompt Context** | `meeting_date` = now, `custom_instructions` = `"Voice Interaction Mode"` | `live_session.py:45-46` |
| 11 | **Tool Name** | `update_task_draft` | `live_session.py:16` |
| 12 | **Tool Required Fields** | `title` only | `live_session.py:27` |
| 13 | **Tool Response to Client** | JSON `{"type": "task_update", "data": {args}}` | `live_session.py:128-131` |
| 14 | **Backend Route** | `WS /api/v1/voice/live` | `main.py:29` + `live.py:6` |
| 15 | **Glossary Singleton** | Module-level `GlossaryManager()` at import time | `live_session.py:10` |
| 16 | **Frontend Live Button** | Disabled placeholder, CSS-only (`opacity-50 cursor-not-allowed`) | `VoiceAgentView.tsx:36` |
| 17 | **Frontend WS Client** | Does not exist | N/A |
| 18 | **Frontend Audio Streamer** | Does not exist | N/A |
| 19 | **Frontend Live Store** | Does not exist | N/A |

---

## 7. Zombie Code & Technical Debt

### 7a. Orphaned Backend (Critical)

The entire `live_session.py` (147 lines) and `live.py` (10 lines) are **unreachable from any user-facing path**. No frontend code connects to the `/api/v1/voice/live` WebSocket endpoint. These files are functional dead code.

### 7b. Stale Model ID

`gemini-2.0-flash-exp` is an experimental model ID that is likely deprecated or removed. The Standard Agent already uses `gemini-3-flash-preview` (NLU) and `gemini-2.5-flash-preview-tts` (TTS). The Live Agent needs a model that supports the `BidiGenerateContent` streaming API with native audio I/O.

### 7c. Wrong System Prompt

The Live Agent imports `get_system_prompt()` from `task_processor.py` — this is the **batch processing** system prompt designed for analyzing meeting transcriptions. It instructs the model to output JSON task lists, filter noise from transcriptions, and consolidate tasks. This is fundamentally wrong for a real-time conversational voice agent that should:
- Engage in dialogue
- Ask clarifying questions
- Incrementally build task drafts via tool calls

The Standard Agent has its own dedicated conversational `SYSTEM_INSTRUCTION` in `voice_service.py` (lines 35-79) with persona rules, two-strike clarification logic, and Golden Record field guidance. The Live Agent should use something similar.

### 7d. Raw `websockets` Library

The backend uses the raw `websockets` Python library to connect to Gemini, manually constructing JSON messages. The `google-genai` SDK provides a higher-level `client.aio.live.connect()` API that handles:
- Setup message construction
- Message serialization/deserialization
- Proper error types
- Reconnection patterns

Using the raw library means all protocol details are hand-rolled and fragile.

### 7e. No Error Recovery

- No reconnection logic if the Gemini WS drops
- No graceful shutdown signaling to the client
- No timeout handling for stale connections
- All errors are `print()` statements with no structured logging
- No cleanup of resources on error paths

### 7f. Frontend Zombie: `AudioRecorder.tsx`

`frontend/src/components/voice/AudioRecorder.tsx` (72 lines) is an older duplicate of the recording logic now in `VoiceControls.tsx`. It is not imported anywhere. It should be deleted.

### 7g. Mixed Binary/JSON on Same WebSocket

The backend sends both raw bytes (audio) and JSON (tool call events) on the same WebSocket to the client. The frontend would need to inspect each message's type (`Blob` vs `string`) to route it correctly. This is a valid pattern but adds complexity.

---

## 8. Comparison Readiness Checklist

This table maps each component needed for a functional Live Agent to its current status, priming the next phase (comparison against a working reference and implementation planning).

| Component | Required For | Status | Notes |
|---|---|---|---|
| **Backend WS Endpoint** | Server entry point | ✅ EXISTS | `live.py` — minimal but functional |
| **Backend Session Proxy** | Gemini relay | ⚠️ EXISTS (STALE) | `live_session.py` — wrong model, wrong prompt, raw WS lib |
| **Backend Tool Declaration** | Task draft updates | ✅ EXISTS | `update_task_draft` — well-structured |
| **Backend Tool Response Loop** | Continue after tool call | ✅ EXISTS | Sends `tool_response` back to Gemini |
| **Backend System Prompt** | Agent behavior | ❌ WRONG | Uses batch-processing prompt, not conversational |
| **Backend Model ID** | Gemini streaming | ❌ STALE | `gemini-2.0-flash-exp` — needs update |
| **Backend Error Handling** | Resilience | ❌ MISSING | `print()` only, no recovery |
| **Frontend WS Client** | Network layer | ❌ MISSING | No `liveClient.ts` |
| **Frontend Audio Streamer** | Raw PCM capture | ❌ MISSING | No `audioStreamer.ts` (ScriptProcessor/AudioWorklet) |
| **Frontend Audio Playback** | Play streaming audio | ❌ MISSING | No AudioContext-based PCM playback |
| **Frontend Live Store** | State management | ❌ MISSING | No `useLiveStore.ts` |
| **Frontend UI (Tab Switch)** | Mode toggle | ❌ MISSING | Button is decorative placeholder |
| **Frontend UI (Live Controls)** | Start/stop live session | ❌ MISSING | No live-specific controls |
| **Frontend Tool Call Handler** | Update draft from WS events | ❌ MISSING | No handler for `{"type": "task_update"}` messages |

### Summary Counts

- **✅ Exists & Functional:** 3 components (endpoint, tool declaration, tool response loop)
- **⚠️ Exists but Stale:** 1 component (session proxy)
- **❌ Wrong:** 2 components (system prompt, model ID)
- **❌ Missing:** 8 components (entire frontend stack + backend error handling)

---

*End of Audit. This document captures the state as of 2025-02-07. No changes have been made to the codebase.*
