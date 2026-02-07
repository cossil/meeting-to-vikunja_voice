# Phase 2 Execution — Step 4: UI Integration

**Date:** 2025-02-07
**Status:** COMPLETE
**Plan:** `Docs/plans/live_agent_reconstruction_plan_v2.md` — Phase 2e

---

## Files Created

| File | Lines | Purpose |
|---|---|---|
| `frontend/src/components/voice/LiveControls.tsx` | 133 | Connect/disconnect button, status badge, volume visualizers |
| `frontend/src/components/voice/LiveChatInterface.tsx` | 95 | Real-time transcript display (reads from `useLiveStore`) |
| `frontend/src/components/voice/LiveTaskDraftCard.tsx` | 130 | Task draft form (reads from `useLiveStore`) |

## Files Modified

| File | Change |
|---|---|
| `frontend/src/views/VoiceAgentView.tsx` | Replaced disabled "Em Breve" placeholder with functional mode toggle; conditionally renders Standard vs Live components |

---

## Mode Toggle Design

The header now contains a segmented button group (pill-style) with two options:

| Mode | Button Label | Icon | Components Rendered |
|---|---|---|---|
| **Padrão** (Standard) | "Padrão" | `Mic` | `ChatInterface` + `VoiceControls` + `TaskDraftCard` |
| **Tempo Real** (Live) | "Tempo Real" | `AudioWaveform` | `LiveChatInterface` + `LiveControls` + `LiveTaskDraftCard` |

**Switching behavior:**
- Switching from Live → Standard calls `disconnectLive()` to cleanly tear down the WS + audio resources
- Switching from Standard → Live does not disrupt the Standard session (it remains warm)
- Default mode on mount: `standard` (preserves existing behavior)

---

## LiveControls.tsx — Component Breakdown

### States Consumed (from `useLiveStore`)
`connectionState`, `isStreaming`, `isModelSpeaking`, `userVolume`, `modelVolume`, `error`, `connect`, `disconnect`

### UI Elements

| Element | Condition | Description |
|---|---|---|
| **Error Banner** | `error !== null` | Red alert with `AlertCircle` icon, truncated message |
| **Mic Volume Bar** | `isConnected` | Green gradient progress bar (0-100%), `Mic` icon, percentage label |
| **Speaker Volume Bar** | `isConnected` | Blue gradient progress bar (0-100%), `Volume2` icon, percentage label |
| **Main Button** | Always | Prominent rounded pill button with state-dependent content |
| **Status Badge** | Always | Colored dot + text label showing current state |

### Button States

| State | Text | Icon | Variant |
|---|---|---|---|
| Disconnected | "Conectar ao Gemini Live" | `Zap` | `default` |
| Connecting | "A ligar..." | `Loader2` (spinning) | `default` (dimmed) |
| Connected | "Desconectar" | `PhoneOff` | `destructive` |

### Status Badge States

| Condition | Text | Dot Color |
|---|---|---|
| Error | "Erro" | Red |
| Connecting | "A ligar..." | Yellow (pulsing) |
| Model speaking | "A falar..." | Blue (pulsing) |
| Streaming (mic active) | "A ouvir..." | Green (pulsing) |
| Connected (idle) | "Conectado" | Green |
| Disconnected | "Pronto" | Gray |

---

## LiveChatInterface.tsx — Differences from ChatInterface

| Aspect | ChatInterface (Standard) | LiveChatInterface (Live) |
|---|---|---|
| Store | `useVoiceStore` | `useLiveStore` |
| Agent name | "Vikunja Bot" | "Gemini Live" |
| Avatar | Vikunja Bot avatar | Gemini Live avatar |
| Audio replay button | Yes (`playAudio`) | No (real-time streaming) |
| Empty state | None | "Conecte-se para iniciar..." placeholder |
| Day label | "Hoje" | "Tempo Real" |

---

## LiveTaskDraftCard.tsx — Differences from TaskDraftCard

| Aspect | TaskDraftCard (Standard) | LiveTaskDraftCard (Live) |
|---|---|---|
| Store | `useVoiceStore` | `useLiveStore` |
| Writing indicator | `isProcessing` | `isModelSpeaking` |
| Disabled states | `isProcessing` on buttons | None (real-time, always editable) |
| Form fields | Identical | Identical |
| Sync action | `syncToVikunja()` | `syncToVikunja()` (same pattern) |

---

## Isolation Guarantee

| Constraint | Status |
|---|---|
| `LiveControls` imports only from `useLiveStore` | ✅ |
| `LiveChatInterface` imports only from `useLiveStore` | ✅ |
| `LiveTaskDraftCard` imports only from `useLiveStore` | ✅ |
| Standard Agent components (`ChatInterface`, `VoiceControls`, `TaskDraftCard`) untouched | ✅ |
| `useVoiceStore` untouched | ✅ |
| `api/voice.ts` untouched | ✅ |
| TypeScript compiles with zero errors | ✅ |
| No new dependencies | ✅ |

---

## Next Steps

- **Phase 2f:** End-to-end testing (backend + frontend integration)
