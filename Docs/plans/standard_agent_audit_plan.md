# Standard Agent Audit Plan

**Date:** 2025-02-07
**Objective:** Document the exact current state of the Standard Voice Agent into a single operational manual: `Docs/specs/STANDARD_AGENT_OPERATIONAL_MANUAL.md`.

---

## 1. Proposed Manual Structure

The manual will have the following sections, each documenting **how the system IS right now**, not aspirational design.

### Section A: Pipeline Overview Diagram
- ASCII or Mermaid flowchart showing the full request lifecycle:
  `User Mic → MediaRecorder → Blob → FormData → POST /voice/turn → VoiceService.process_turn → Gemini NLU → Gemini TTS → Base64 WAV → Frontend → Audio Playback`
- Include the text-input alternate path (`sendTextTurn`).
- Include the session init path (`GET /voice/warmup` → `GET /voice/greeting`).

### Section B: Frontend — Audio Capture
- **Source file:** `frontend/src/components/voice/VoiceControls.tsx`
- Configurations to extract:
  - `getUserMedia` constraints (currently: `{ audio: true }` — no sample rate, channel, or codec specified)
  - `MediaRecorder` constructor options (currently: **none** — browser defaults for MIME type and codec)
  - `ondataavailable` chunking strategy (push all chunks, concatenate on stop)
  - Blob construction MIME type label (currently: `'audio/wav'` — **NOTE: this is a label mismatch; MediaRecorder actually outputs browser-default webm/ogg, not raw WAV**)
  - UI state flags: `isRecording`, `isProcessing`, `isPlaying` and their gating logic

### Section C: Frontend — API Transport Layer
- **Source files:** `frontend/src/api/voice.ts`, `frontend/src/api/client.ts`
- Configurations to extract:
  - Axios base URL: `VITE_API_URL` env var, fallback `http://localhost:8000/api/v1`
  - **`sendTurn` endpoint:** `POST /voice/turn` with `multipart/form-data`
    - FormData fields: `file` (Blob, filename `'input.wav'`), `state` (JSON string of `VoiceState`)
  - **`sendTextTurn` endpoint:** Same `POST /voice/turn`
    - FormData fields: `text` (string), `state` (JSON string of `VoiceState`)
  - **`warmup` endpoint:** `GET /voice/warmup`
  - **`getGreeting` endpoint:** `GET /voice/greeting` (responseType: `'blob'`)
  - Response handling: Base64 `reply_audio` → `atob` → `Uint8Array` → `Blob({ type: 'audio/wav' })` → `URL.createObjectURL`

### Section D: Frontend — State Management (Zustand Store)
- **Source file:** `frontend/src/store/useVoiceStore.ts`
- Configurations to extract:
  - `INITIAL_TASK_STATE` shape: `{ title: null, description: null, dueDate: null, assignee: null, status: 'draft', priority: 3 }`
  - `VoiceState` TypeScript interface (from `frontend/src/types/schema.ts`)
  - `VoiceTurnResponse` interface: `{ updated_state: VoiceState, reply_audio: string (Base64), should_end_session?: boolean }`
  - Session init flow: `warmup()` → `getGreeting()` → add agent message → `playAudio()`
  - Audio playback mechanism: `new Audio(url)` with `onended`/`onerror` handlers
  - Vikunja sync flow: `syncToVikunja()` maps `VoiceState` → `TaskBase` and calls `batchApi.syncTasks`

### Section E: Backend — Endpoint Layer
- **Source file:** `backend/app/api/endpoints/voice.py`
- Configurations to extract:
  - Router prefix (document where it's mounted in the FastAPI app)
  - `POST /turn` signature: `file: UploadFile | None`, `text: str | None`, `state: str` (required Form field)
  - State parsing: `json.loads(state)` with 400 error on invalid JSON
  - Audio read: `await file.read()` → raw bytes
  - Response format: `JSONResponse` with `{ updated_state: dict, reply_audio: str|null (Base64) }`
  - `GET /warmup`: calls `service.warmup_tts()`
  - `GET /greeting`: returns `FileResponse("welcome_fixed.wav", media_type="audio/wav")` — file resolved relative to CWD

### Section F: Backend — NLU Processing (The Brain)
- **Source file:** `backend/app/services/voice_service.py`
- **Critical configurations to extract:**
  - **NLU Model ID:** `gemini-3-flash-preview`
  - **TTS Model ID:** `gemini-2.5-flash-preview-tts`
  - **TTS Voice Name:** `Puck`
  - **NLU Generation Config:**
    - `max_output_tokens`: 1500
    - `temperature`: 0.6
    - `top_p`: 0.95
    - `top_k`: 40
    - `response_mime_type`: `"application/json"`
    - `response_schema`: `VoiceGeminiResponse` (Pydantic model, enforced structured output)
  - **System Instruction (FULL TEXT):** The complete `SYSTEM_INSTRUCTION` string (lines 35-79), including:
    - Persona rules ("Humilde, prestativo...")
    - Two-Strike Rule for clarification
    - Golden Record fields: Título, Descrição, Data de Vencimento, Responsável
    - Title constraints (max 6 words, no repetition, no codes)
    - Description constraint (max 150 chars)
    - `{glossary_rules}` placeholder injection point
    - Expected JSON output schema
  - **Per-Turn Prompt Context Template** (lines 188-200): includes `current_date`, `current_state` JSON, and inline instructions
  - **Content Parts Construction:**
    - Always: `Part(text=prompt_context)`
    - If text input: `Part(text=f"Entrada de texto do usuário: {user_text}")`
    - If audio input: `Part(inline_data=Blob(data=audio_bytes, mime_type="audio/wav"))`
  - **Response Parsing:** `response.parsed` → `VoiceGeminiResponse` Pydantic model → `model_dump(by_alias=True)`
  - **Fallback on error:** Returns `current_state` unchanged + TTS of "Desculpe, tive um problema técnico. Pode repetir?"

### Section G: Backend — TTS Pipeline
- **Source file:** `backend/app/services/voice_service.py` (methods: `generate_speech`, `_pcm_to_wav`, `warmup_tts`)
- Configurations to extract:
  - TTS API call: `client.models.generate_content` with `response_modalities=[Modality.AUDIO]`
  - `SpeechConfig` → `VoiceConfig` → `PrebuiltVoiceConfig(voice_name="Puck")`
  - Raw output: PCM bytes from `part.inline_data.data`
  - WAV conversion: `_pcm_to_wav` — 1 channel (Mono), 16-bit (sampwidth=2), **24000 Hz sample rate**
  - Warmup also generates `welcome_fixed.wav` if missing, using greeting text: `"Olá! Sou o assistente de tarefas do Vikunja. Como posso ajudar você hoje?"`

### Section H: Backend — Glossary System
- **Source files:** `backend/app/services/task_processor.py` (class `GlossaryManager`), `glossary.json` (root)
- Configurations to extract:
  - File path: `data/glossary.json` (relative, with auto-create from seed data)
  - **Note:** A second `glossary.json` exists at project root — document both and their relationship
  - Seed data entries (7 entries hardcoded in `GlossaryManager.__init__`)
  - Live file entries (10 entries in root `glossary.json`, includes additions: Lead, Leads, Grandstream)
  - Prompt injection format: `"- Se ouvir: {variations} -> Escreva: {correct_term}"`

### Section I: Backend — Pydantic Models & Contracts
- **Source file:** `backend/app/services/voice_service.py` (lines 17-32)
- Models to document:
  - `ClarificationStrike`: `{ field: str, count: int }`
  - `VoiceTaskState`: `{ title, description, due_date (alias dueDate), assignee, status (default "Em Progresso"), missing_info (alias missingInfo, default all 4 fields), clarification_strikes (alias clarificationStrikes) }`
  - `VoiceGeminiResponse`: `{ reply_text (alias replyText), updated_task (alias updatedTask): VoiceTaskState }`
  - **Note the state mismatch:** Frontend `INITIAL_TASK_STATE.status` = `'draft'`, Backend `VoiceTaskState.status` default = `'Em Progresso'`

### Section J: Environment & Configuration
- **Source file:** `backend/app/core/config.py`
- Variables to document:
  - `GOOGLE_API_KEY` (required)
  - `VIKUNJA_API_TOKEN` (required)
  - `VIKUNJA_API_URL` (required)
  - Env file location: `../.env` (relative to backend dir)
  - Frontend env: `VITE_API_URL` (optional, defaults to `http://localhost:8000/api/v1`)

---

## 2. Key Configurations Checklist

The manual MUST capture these exact values verbatim from the current code:

| # | Configuration | Current Value | Source File:Line |
|---|---|---|---|
| 1 | NLU Model ID | `gemini-3-flash-preview` | `voice_service.py:88` |
| 2 | TTS Model ID | `gemini-2.5-flash-preview-tts` | `voice_service.py:86` |
| 3 | TTS Voice Name | `Puck` | `voice_service.py:103` |
| 4 | TTS Output Sample Rate | `24000 Hz` | `voice_service.py:127` |
| 5 | TTS Output Format | Mono, 16-bit PCM wrapped in WAV | `voice_service.py:127-135` |
| 6 | NLU Temperature | `0.6` | `voice_service.py:218` |
| 7 | NLU top_p | `0.95` | `voice_service.py:219` |
| 8 | NLU top_k | `40` | `voice_service.py:220` |
| 9 | NLU max_output_tokens | `1500` | `voice_service.py:217` |
| 10 | NLU response_mime_type | `application/json` | `voice_service.py:222` |
| 11 | NLU response_schema | `VoiceGeminiResponse` (Pydantic) | `voice_service.py:223` |
| 12 | System Instruction | Full text (lines 35-79) | `voice_service.py:35-79` |
| 13 | Per-Turn Prompt Template | Full text (lines 188-200) | `voice_service.py:188-200` |
| 14 | Audio Input MIME to Gemini | `audio/wav` | `voice_service.py:210` |
| 15 | Frontend MediaRecorder options | None (browser defaults) | `VoiceControls.tsx:17` |
| 16 | Frontend Blob label | `audio/wav` | `VoiceControls.tsx:28` |
| 17 | FormData file field name | `file`, filename `input.wav` | `voice.ts:18` |
| 18 | FormData state field name | `state` | `voice.ts:19` |
| 19 | Greeting text | `"Olá! Sou o assistente..."` | `voice_service.py:114` |
| 20 | Greeting file path | `welcome_fixed.wav` (CWD-relative) | `voice.py:25` |
| 21 | Glossary file path | `data/glossary.json` | `task_processor.py:17` |
| 22 | Fallback error text | `"Desculpe, tive um problema..."` | `voice_service.py:246` |
| 23 | Initial frontend task status | `draft` | `useVoiceStore.ts:37` |
| 24 | Backend default task status | `Em Progresso` | `voice_service.py:26` |

---

## 3. Known Anomalies to Document

These are not bugs to fix — they are **facts to record** so we understand the system as-is:

1. **MIME Type Mismatch (Frontend):** `MediaRecorder` is instantiated with no options, so the browser picks its default codec (typically `audio/webm;codecs=opus` on Chrome). The resulting chunks are labeled `audio/wav` in the Blob constructor, but the actual bytes are webm/opus. Gemini appears to handle this gracefully.

2. **Glossary Dual Location:** `GlossaryManager` reads from `data/glossary.json` but a separate `glossary.json` exists at project root. The root file has 3 extra entries not in the seed data. Need to confirm which one is actually loaded at runtime (depends on CWD).

3. **State Schema Mismatch:** Frontend initializes `status: 'draft'`, backend Pydantic default is `'Em Progresso'`. The backend overwrites this on first Gemini response, so it's functionally harmless but worth noting.

4. **No Explicit Audio Constraints:** `getUserMedia({ audio: true })` uses browser defaults for sample rate, channels, bit depth. No explicit constraints are set.

---

## 4. Execution Plan

| Step | Action | Output |
|---|---|---|
| 1 | ✅ Read all source files in the pipeline | This plan |
| 2 | Create `Docs/specs/STANDARD_AGENT_OPERATIONAL_MANUAL.md` | Sections A-J populated with verbatim values |
| 3 | Embed full system prompt text and per-turn template as fenced code blocks | Exact copy, no edits |
| 4 | Include the configurations table (Section 2 above) as a quick-reference appendix | Searchable table |
| 5 | Record anomalies (Section 3) in a dedicated "Known Anomalies" section | Factual, no fixes |
| 6 | Review with user before finalizing | Approval gate |
