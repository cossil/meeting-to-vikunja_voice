# Model Policy Update

**Date:** 2025-02-07
**Trigger:** User rejected `gemini-2.0-flash-exp` for Live Agent. New Model Policy established.

---

## Model Policy

| Role | Model ID | File | Line |
|---|---|---|---|
| **Live Voice (WebSocket)** | `gemini-2.5-flash-native-audio-preview-12-2025` | `backend/app/services/live_session.py` | 66 |
| **Text Processing (Batch)** | `gemini-3-flash-preview` | `backend/app/services/task_processor.py` | 89 |
| **NLU (Standard Agent)** | `gemini-3-flash-preview` | `backend/app/services/voice_service.py` | 88 |
| **TTS (Standard Agent)** | `gemini-2.5-flash-preview-tts` | `backend/app/services/voice_service.py` | 86 |

---

## Changes Made

| File | Before | After | Changed? |
|---|---|---|---|
| `live_session.py:66` | `gemini-2.0-flash-exp` | `gemini-2.5-flash-native-audio-preview-12-2025` | **YES** |
| `task_processor.py:89` | `gemini-3-flash-preview` | `gemini-3-flash-preview` | No (already correct) |
| `voice_service.py:88` (NLU) | `gemini-3-flash-preview` | `gemini-3-flash-preview` | No (already correct) |
| `voice_service.py:86` (TTS) | `gemini-2.5-flash-preview-tts` | `gemini-2.5-flash-preview-tts` | No (already correct) |

---

## Notes

- `voice_service.py` uses **two separate models**: `gemini-3-flash-preview` for NLU (text understanding + JSON response) and `gemini-2.5-flash-preview-tts` for audio generation. Both are already aligned with the policy.
- The Live Agent model (`gemini-2.5-flash-native-audio-preview-12-2025`) supports native audio input/output via the v1alpha BidiGenerateContent WebSocket endpoint.
- `gemini-2.0-flash-exp` is **no longer used anywhere** in the codebase.
