# Live Agent Backend Update — Protocol Changes

**Date:** 2025-02-07
**File Modified:** `backend/app/services/live_session.py`
**Plan Reference:** `Docs/plans/live_agent_reconstruction_plan_v2.md` §2b, §7

---

## Changes Applied

### 1. Model ID (line 66)
- **Before:** `gemini-2.0-flash-exp`
- **After:** `gemini-2.5-flash-native-audio-preview-12-2025` *(updated per Model Policy — native audio model for v1alpha BidiGenerateContent endpoint)*

### 2. MIME Type (line 137)
- **Before:** `audio/pcm`
- **After:** `audio/pcm;rate=16000`
- **Reason:** Reference sends `audio/pcm;rate=16000`. Missing rate caused Gemini to assume wrong sample rate.

### 3. System Prompt (lines 18–40)
- **Before:** Reused batch-processing prompt from `task_processor.get_system_prompt()` (designed for file analysis, not conversation).
- **After:** New `LIVE_SYSTEM_INSTRUCTION` constant — conversational persona prompt adapted from `voice_service.py` patterns. Includes glossary injection via `{glossary_rules}` placeholder.
- **Removed import:** `get_system_prompt` (no longer needed), `datetime` (no longer needed).

### 4. Setup Message — `generation_config` (lines 87–96)
Added to match reference `geminiLiveClient.ts:68-88`:
```json
{
  "response_modalities": ["AUDIO"],
  "speech_config": {
    "voice_config": {
      "prebuilt_voice_config": {
        "voice_name": "Kore"
      }
    }
  }
}
```

### 5. Setup Message — Transcription Config (lines 101–102)
- **Added:** `"input_audio_transcription": {}` and `"output_audio_transcription": {}`
- **Reason:** Enables real-time transcription events from Gemini (reference `geminiLiveClient.ts:86-87`).

### 6. New Event Forwarding — Transcription (lines 199–216)
- Forwards `inputTranscription` → `{"type": "transcript", "source": "user", ...}`
- Forwards `outputTranscription` → `{"type": "transcript", "source": "model", ...}`

### 7. New Event Forwarding — Turn Lifecycle (lines 218–223)
- Forwards `turnComplete` → `{"type": "turn_complete"}`
- Forwards `interrupted` → `{"type": "interrupted"}`

### 8. Control Message Handling (lines 144–153)
- **Before:** Text messages from client were silently ignored (`pass`).
- **After:** Parses JSON, handles `{"type": "stop"}` control message with logging.

---

## Non-Functional Improvements

| Change | Lines | Reason |
|---|---|---|
| Replaced `print()` with `logging.getLogger()` | Throughout | Production-grade logging |
| Added `websockets.exceptions.ConnectionClosed` handler | 116, 225 | Graceful handling of expected WS closures |
| Added `finally` block in `start()` | 120–124 | Ensures client WS is always closed |
| Error forwarding to client | 229–232 | Client receives `{"type": "error"}` on unexpected failures |

---

## Isolation Verification

| File | Status |
|---|---|
| `backend/app/services/voice_service.py` | **NOT MODIFIED** |
| `backend/app/api/endpoints/voice.py` | **NOT MODIFIED** |
| `backend/app/api/endpoints/live.py` | **NOT MODIFIED** |
| `backend/app/services/task_processor.py` | **NOT MODIFIED** |
| `backend/tests/test_endpoints.py` | **NOT MODIFIED** |

Only `backend/app/services/live_session.py` was changed. Confirmed via `git diff --name-only HEAD`.
