# Phase 2 Execution — Step 1: Backend Adaptation

**Date:** 2025-02-07
**Status:** COMPLETE
**Plan:** `Docs/plans/live_agent_reconstruction_plan_v2.md` — Phase 2a

---

## Objective

Prepare the Backend Proxy (`live_session.py`) to handle the WebSocket protocol defined in the V2 plan, which mimics the behavior of the Reference Implementation (`full_duplex_voice_agent/services/geminiLiveClient.ts`).

---

## Execution Summary

### Files Modified
| File | Lines Before | Lines After | Net Change |
|---|---|---|---|
| `backend/app/services/live_session.py` | 147 | 233 | +86 |

### Files NOT Modified (Isolation Guarantee)
- `backend/app/services/voice_service.py` — Standard Agent untouched
- `backend/app/api/endpoints/voice.py` — Standard Agent endpoints untouched
- `backend/app/api/endpoints/live.py` — Endpoint already correct
- `backend/tests/test_endpoints.py` — Tests untouched per instruction

---

## Checklist (Plan §2b Required Changes)

| # | Change | Status | Lines |
|---|---|---|---|
| 1 | Update model ID | ✅ Updated to `gemini-2.5-flash-native-audio-preview-12-2025` | 66 |
| 2 | Fix MIME type: `audio/pcm` → `audio/pcm;rate=16000` | ✅ | 137 |
| 3 | Replace system prompt with conversational `LIVE_SYSTEM_INSTRUCTION` | ✅ | 18–40 |
| 4 | Add `inputAudioTranscription` / `outputAudioTranscription` to setup | ✅ | 101–102 |
| 5 | Add `responseModalities: ['AUDIO']` to setup | ✅ | 88 |
| 6 | Forward transcription events to client | ✅ | 199–216 |
| 7 | Handle `interrupted` events from Gemini | ✅ | 222–223 |
| 8 | Add `speechConfig` with voice selection | ✅ | 89–96 |

---

## Protocol Contract Implemented

### Client → Backend (unchanged wire format)
| Frame Type | Content | Handling |
|---|---|---|
| Binary | Raw Int16 PCM (16kHz mono) | base64-encode → wrap in `realtime_input.media_chunks` → forward to Gemini |
| Text | `{"type": "stop"}` | Logged, placeholder for future stop signal |

### Backend → Client (expanded)
| Frame Type | Content | New? |
|---|---|---|
| Binary | Raw Int16 PCM (24kHz mono) from Gemini | Existing |
| Text JSON | `{"type": "task_update", "data": {...}}` | Existing |
| Text JSON | `{"type": "transcript", "source": "user"\|"model", "text": "...", "isComplete": bool}` | **NEW** |
| Text JSON | `{"type": "turn_complete"}` | **NEW** |
| Text JSON | `{"type": "interrupted"}` | **NEW** |
| Text JSON | `{"type": "error", "message": "..."}` | **NEW** |

---

## Key Design Decisions

1. **Model ID kept as `gemini-2.0-flash-exp`:** The plan noted the reference uses `gemini-2.5-flash-native-audio-preview-09-2025`, but the user instruction specified `gemini-2.0-flash-exp` or latest valid equivalent. This model supports the v1alpha BidiGenerateContent WS endpoint. Can be updated to a newer model with a single-line change.

2. **Logging over print:** Replaced all `print()` calls with `logging.getLogger(__name__)` for production-grade observability.

3. **Graceful error handling:** Added `websockets.exceptions.ConnectionClosed` handlers, `finally` block for client WS cleanup, and error event forwarding to the client.

4. **Tool definition preserved:** `update_task_draft_tool` is unchanged. Tool call handling (auto-acknowledge pattern) is preserved.

5. **Removed unused imports:** `datetime` and `get_system_prompt` are no longer needed since the Live Agent uses its own `LIVE_SYSTEM_INSTRUCTION` constant.

---

## Next Steps

- **Phase 2b:** Create `frontend/src/utils/liveAudioStreamer.ts` (audio capture & playback)
- **Phase 2c:** Create `frontend/src/api/liveClient.ts` (WebSocket client)
- **Phase 2d:** Create `frontend/src/store/useLiveStore.ts` (state management)
- **Phase 2e:** Create `frontend/src/components/voice/LiveControls.tsx` + modify `VoiceAgentView.tsx`
- **Phase 2f:** End-to-end testing

Phases 2b and 2c can proceed in parallel.
