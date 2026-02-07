# Standard Voice Agent — Operational Manual (Source of Truth)

**Generated:** 2025-02-07
**Status:** LOCKED — Do not modify application code based on this document. This records how the system IS.
**Audit Plan:** `Docs/plans/standard_agent_audit_plan.md`

---

## Section A: Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SESSION INITIALIZATION                               │
│                                                                             │
│  Frontend                          Backend                                  │
│  ────────                          ───────                                  │
│  useVoiceStore.initSession()                                                │
│       │                                                                     │
│       ├──► GET /voice/warmup ────► VoiceService.warmup_tts()                │
│       │                            ├─ Silent generate_content (TTS model)   │
│       │                            └─ Generate welcome_fixed.wav if missing │
│       │                                                                     │
│       └──► GET /voice/greeting ──► FileResponse("welcome_fixed.wav")        │
│              │                                                              │
│              ▼                                                              │
│         playAudio(greetingUrl)                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        VOICE TURN (Audio Path)                              │
│                                                                             │
│  User Mic                                                                   │
│     │                                                                       │
│     ▼                                                                       │
│  getUserMedia({ audio: true })                                              │
│     │                                                                       │
│     ▼                                                                       │
│  MediaRecorder (browser defaults)                                           │
│     │  ondataavailable → chunksRef.push(e.data)                             │
│     │  onstop → Blob(chunks, { type: 'audio/wav' })                         │
│     │                                                                       │
│     ▼                                                                       │
│  voiceApi.sendTurn(audioBlob, currentTask)                                  │
│     │  FormData: file=Blob("input.wav"), state=JSON.stringify(VoiceState)   │
│     │                                                                       │
│     ▼                                                                       │
│  POST /api/v1/voice/turn  (multipart/form-data)                             │
│     │                                                                       │
│     ▼                                                                       │
│  voice.py: json.loads(state), await file.read()                             │
│     │                                                                       │
│     ▼                                                                       │
│  VoiceService.process_turn(audio_bytes, current_state)                      │
│     │                                                                       │
│     ├──► Gemini NLU (gemini-3-flash-preview)                                │
│     │    Contents: [Part(text=prompt_context), Part(inline_data=audio)]     │
│     │    Config: temp=0.6, top_p=0.95, top_k=40, max_tokens=1500            │
│     │    System Instruction: SYSTEM_INSTRUCTION + glossary                  │
│     │    Response: VoiceGeminiResponse (structured JSON)                    │
│     │         │                                                             │
│     │         ▼                                                             │
│     │    parsed_response.reply_text ──► generate_speech()                   │
│     │                                       │                               │
│     ├──► Gemini TTS (gemini-2.5-flash-preview-tts)                          │
│     │    Voice: "Puck"                                                      │
│     │    Output: raw PCM → _pcm_to_wav(24kHz, Mono, 16-bit)                 │
│     │                                                                       │
│     ▼                                                                       │
│  JSONResponse: { updated_state, reply_audio: base64(wav_bytes) }            │
│     │                                                                       │
│     ▼                                                                       │
│  Frontend: atob(base64) → Uint8Array → Blob("audio/wav") → createObjectURL  │
│     │                                                                       │
│     ▼                                                                       │
│  playAudio(url) → new Audio(url).play()                                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        TEXT TURN (Alternate Path)                           │
│                                                                             │
│  Same as Voice Turn, except:                                                │
│  - FormData: text=string, state=JSON (no file field)                        │
│  - Backend: audio_bytes=None, user_text=text                                │
│  - NLU Contents: [Part(text=prompt_context),                                │
│                    Part(text="Entrada de texto do usuário: {text}")]        │
│  - Everything else identical                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Section B: Frontend — Audio Capture

**Source:** `frontend/src/components/voice/VoiceControls.tsx`

### getUserMedia Constraints

```typescript
// VoiceControls.tsx:16
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
```

- **Constraints:** `{ audio: true }` — no sample rate, channel count, echo cancellation, or noise suppression specified.
- Browser applies its own defaults (typically 48kHz, mono, with echo cancellation on).

### MediaRecorder Configuration

```typescript
// VoiceControls.tsx:17
const mediaRecorder = new MediaRecorder(stream);
```

- **Constructor options:** None. No `mimeType`, `audioBitsPerSecond`, or other options passed.
- Browser picks default codec (Chrome: `audio/webm;codecs=opus`, Firefox: `audio/ogg;codecs=opus`).

### Chunking Strategy

```typescript
// VoiceControls.tsx:21-24
mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
        chunksRef.current.push(e.data);
    }
};
```

- No `timeslice` argument to `mediaRecorder.start()` — single chunk emitted on stop.

### Blob Construction

```typescript
// VoiceControls.tsx:28
const audioBlob = new Blob(chunksRef.current, { type: 'audio/wav' });
```

- **Label:** `'audio/wav'`
- **Actual content:** Browser-default webm/opus (see Known Anomalies, Section K).

### Stream Cleanup

```typescript
// VoiceControls.tsx:30
stream.getTracks().forEach(track => track.stop());
```

### UI State Gating

```typescript
// VoiceControls.tsx:90
disabled={isProcessing || isPlaying}
```

- Mic button is disabled while processing a turn or playing agent audio.
- Recording button toggles between `startRecording` and `stopRecording`.

---

## Section C: Frontend — API Transport Layer

**Source:** `frontend/src/api/voice.ts`, `frontend/src/api/client.ts`

### Axios Client

```typescript
// client.ts:3
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

// client.ts:5-10
export const client = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});
```

### Endpoint: `warmup`

```typescript
// voice.ts:5-7
warmup: async (): Promise<void> => {
    await client.get('/voice/warmup');
},
```

### Endpoint: `getGreeting`

```typescript
// voice.ts:9-14
getGreeting: async (): Promise<string> => {
    const response = await client.get('/voice/greeting', {
        responseType: 'blob',
    });
    return URL.createObjectURL(response.data);
},
```

- Returns a Blob URL for direct `<audio>` playback.

### Endpoint: `sendTurn` (Audio)

```typescript
// voice.ts:16-39
sendTurn: async (audioBlob: Blob, currentState: VoiceState) => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'input.wav');
    formData.append('state', JSON.stringify(currentState));

    const response = await client.post<VoiceTurnResponse>('/voice/turn', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });

    // Base64 decode
    const byteCharacters = atob(response.data.reply_audio);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const audioUrl = URL.createObjectURL(new Blob([byteArray], { type: 'audio/wav' }));

    return { updatedState: response.data.updated_state, audioUrl };
},
```

- **FormData fields:** `file` (Blob, filename `'input.wav'`), `state` (JSON string)
- **Response decoding:** Base64 string → `atob` → byte array → `Blob({ type: 'audio/wav' })` → `URL.createObjectURL`

### Endpoint: `sendTextTurn` (Text)

```typescript
// voice.ts:42-66
sendTextTurn: async (text: string, currentState: VoiceState) => {
    const formData = new FormData();
    formData.append('text', text);
    formData.append('state', JSON.stringify(currentState));

    const response = await client.post<VoiceTurnResponse>('/voice/turn', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
    // ... identical Base64 decode logic ...
},
```

- Same endpoint (`POST /voice/turn`), same response handling. Only difference: `text` field instead of `file`.

---

## Section D: Frontend — State Management (Zustand Store)

**Source:** `frontend/src/store/useVoiceStore.ts`, `frontend/src/types/schema.ts`

### VoiceState Interface

```typescript
// schema.ts:32-40
export interface VoiceState {
    title: string | null;
    description: string | null;
    dueDate: string | null;
    assignee: string | null;
    status: 'draft' | 'ready';
    priority?: number;
    _reply_text?: string;
}
```

### VoiceTurnResponse Interface

```typescript
// schema.ts:42-46
export interface VoiceTurnResponse {
    updated_state: VoiceState;
    reply_audio: string; // Base64 encoded audio
    should_end_session?: boolean;
}
```

### Initial Task State

```typescript
// useVoiceStore.ts:31-38
const INITIAL_TASK_STATE: VoiceState = {
    title: null,
    description: null,
    dueDate: null,
    assignee: null,
    status: 'draft',
    priority: 3
};
```

### Session Init Flow

```typescript
// useVoiceStore.ts:70-86
initSession: async () => {
    set({ isProcessing: true, error: null, messages: [] });
    try {
        await voiceApi.warmup();
        const greetingUrl = await voiceApi.getGreeting();
        set((state) => ({
            messages: [...state.messages, {
                role: 'agent',
                content: "Olá! Sou o assistente de tarefas do Vikunja. Como posso ajudar você hoje?",
                audioUrl: greetingUrl
            }],
            isProcessing: false
        }));
        await get().playAudio(greetingUrl);
    } catch (err: any) {
        set({ error: err.message || "Failed to initialize voice session", isProcessing: false });
    }
},
```

- Sequence: `warmup()` → `getGreeting()` → add agent message to chat → `playAudio()`.

### Audio Playback

```typescript
// useVoiceStore.ts:50-68
playAudio: async (url: string) => {
    set({ isPlaying: true });
    const audio = new Audio(url);
    audio.onended = () => { set({ isPlaying: false }); };
    audio.onerror = () => { set({ isPlaying: false, error: "Failed to play audio" }); };
    try {
        await audio.play();
    } catch (e) {
        console.error("Audio playback failed", e);
        set({ isPlaying: false });
    }
},
```

- Uses `HTMLAudioElement` (not Web Audio API).
- Sets `isPlaying` flag to gate mic button.

### Vikunja Sync Flow

```typescript
// useVoiceStore.ts:152-184
syncToVikunja: async () => {
    const { currentTask } = get();
    if (!currentTask.title) return;
    // Maps VoiceState → { title, description, assignee_name, assignee_id: null, priority, due_date }
    // Calls batchApi.syncTasks([taskToSync])
    // On success: resets task, adds success message
},
```

---

## Section E: Backend — Endpoint Layer

**Source:** `backend/app/api/endpoints/voice.py`

### Router Setup

```python
# voice.py:7-8
router = APIRouter()
service = VoiceService()
```

- `VoiceService` is instantiated once at module level (singleton per worker).

### GET /warmup

```python
# voice.py:10-17
@router.get("/warmup")
async def warmup_model():
    """Triggers a silent generation to warm up the TTS/LLM connection."""
    try:
        service.warmup_tts()
        return {"status": "warmup_initiated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### GET /greeting

```python
# voice.py:19-26
@router.get("/greeting")
async def get_greeting():
    """Returns the static welcome audio file."""
    file_path = "welcome_fixed.wav"  # Resolves relative to CWD (usually root)
    return FileResponse(file_path, media_type="audio/wav")
```

- **File path:** `welcome_fixed.wav` — resolved relative to the process CWD.
- **Media type:** `audio/wav`

### POST /turn

```python
# voice.py:28-68
@router.post("/turn")
async def process_voice_turn(
    file: UploadFile | None = File(None),
    text: str | None = Form(None),
    state: str = Form(...)   # REQUIRED
):
```

**Processing steps:**
1. Parse `state` via `json.loads(state)` — returns 400 on invalid JSON.
2. Validate that at least one of `file` or `text` is provided — returns 400 if neither.
3. Read audio: `audio_bytes = await file.read() if file else None`
4. Call `service.process_turn(audio_bytes, current_state, text)`
5. Encode reply audio to Base64: `base64.b64encode(reply_audio_bytes).decode('utf-8')`
6. Return `JSONResponse({ "updated_state": dict, "reply_audio": str|null })`

---

## Section F: Backend — NLU Processing (The Brain)

**Source:** `backend/app/services/voice_service.py`

### Model IDs

```python
# voice_service.py:86-88
self.tts_model = "gemini-2.5-flash-preview-tts"
self.nlu_model = "gemini-3-flash-preview"
```

### Gemini Client

```python
# voice_service.py:84
self.client = genai.Client(api_key=self.api_key)
```

- Uses `google.genai.Client` (the new unified SDK), not the legacy `google.generativeai`.

### System Instruction (VERBATIM)

```python
# voice_service.py:35-79
SYSTEM_INSTRUCTION = """
Você é o "Assistente de Tarefas". Sua missão é extrair informações de uma conversa para criar uma "Ficha de Tarefa".
Fale APENAS em Português do Brasil (pt-BR).

**Sua Persona:**
- Humilde, prestativo, ansioso para aprender.
- Use frases como "Desculpe, não entendi...", "Só para confirmar...", "Anotei aqui...".
- NUNCA diga apenas "OK". Sempre reflita o que entendeu.
- **Seja CONCISO. Use no máximo 2-3 frases curtas na resposta.**

**Regras de Negócio:**
1. **The Two-Strike Rule**: Se o usuário fornecer informações pouco claras sobre um campo específico duas vezes, pare de perguntar e marque o campo como "A Revisar".
2. **Escuta Reflexiva**: Resuma brevemente o que já foi coletado.
3. **Golden Record**: Colete: Título, Descrição, Data de Vencimento, Responsável.
4. **Glossário e Correção de Nomes**:
   Use as regras abaixo para identificar os nomes corretos dos responsáveis e termos técnicos:
   {glossary_rules}

**Saída JSON:**
Você deve retornar estritamente um JSON.

REGRAS ESTRITAS PARA PREVENIR ERROS DE REPETIÇÃO:
1. **NÃO** inclua explicações ou metadados nos valores.
2. **Título ("title")**:
   - MÁXIMO 6 PALAVRAS.
   - **PROIBIDO** repetir palavras consecutivas (Ex: "Rádio Rádio").
   - **PROIBIDO** gerar códigos ou sequências como "Ferbasa-BA-Ferbasa-BA".
   - Use APENAS linguagem natural simples.
   - Exemplo Bom: "Cotação de 10 Rádios".
3. **Descrição ("description")**: Resumo objetivo (Max 150 caracteres).

Formato esperado:
{
  "replyText": "Resposta curta aqui...",
  "updatedTask": {
    "title": "Titulo Curto",
    "description": "Descricao",
    "dueDate": "YYYY-MM-DD",
    "assignee": "Nome",
    "status": "Em Progresso",
    "missingInfo": ["campo1"],
    "clarificationStrikes": [{"field": "dueDate", "count": 1}]
  }
}
"""
```

- **`{glossary_rules}` placeholder** is replaced at runtime with output from `GlossaryManager.get_prompt_rules()`.

### Per-Turn Prompt Context Template (VERBATIM)

```python
# voice_service.py:188-200
prompt_context = f"""
    Data de hoje: {current_date}.
    Estado atual da Tarefa (JSON): {json.dumps(current_state)}.
    
    INSTRUÇÕES:
    1. Analise o áudio do usuário (em português).
    2. Atualize a "updatedTask". 
       - "title": MÁXIMO 6 PALAVRAS. Nunca repita palavras. NÃO USE CÓDIGOS TÉCNICOS.
       - "description": Resumo do contexto (Max 150 caracteres).
       - Se um campo não mudou, mantenha o valor anterior.
    3. Gere "replyText": Resposta curta (max 1 frase) na persona "Assistente de Tarefas".
    4. RETORNE APENAS JSON VÁLIDO.
"""
```

- `current_date` is formatted as `datetime.now().strftime('%d/%m/%Y')`.
- `current_state` is the raw dict received from the frontend (passed through `json.dumps`).

### NLU Generation Config

```python
# voice_service.py:216-224
config=types.GenerateContentConfig(
    max_output_tokens=1500,
    temperature=0.6,
    top_p=0.95,
    top_k=40,
    system_instruction=system_instruction_with_glossary,
    response_mime_type="application/json",
    response_schema=VoiceGeminiResponse
)
```

| Parameter | Value |
|---|---|
| `max_output_tokens` | `1500` |
| `temperature` | `0.6` |
| `top_p` | `0.95` |
| `top_k` | `40` |
| `response_mime_type` | `"application/json"` |
| `response_schema` | `VoiceGeminiResponse` (Pydantic model — enforces structured output) |

### Content Parts Construction

```python
# voice_service.py:204-210
contents = [types.Part(text=prompt_context)]

if user_text:
    contents.append(types.Part(text=f"Entrada de texto do usuário: {user_text}"))

if audio_bytes:
    contents.append(types.Part(inline_data=types.Blob(data=audio_bytes, mime_type="audio/wav")))
```

- Audio is always sent with MIME type `"audio/wav"` regardless of actual encoding.
- Text and audio paths are not mutually exclusive in the code (both could theoretically be present).

### Response Parsing

```python
# voice_service.py:227-241
if not response.parsed:
    raise ValueError("Gemini returned no parsed data.")

parsed_response: VoiceGeminiResponse = response.parsed

reply_audio = self.generate_speech(parsed_response.reply_text)
updated_state = parsed_response.updated_task.model_dump(by_alias=True)
updated_state['_reply_text'] = parsed_response.reply_text

return updated_state, reply_audio
```

- Uses `response.parsed` (Pydantic structured output from Gemini SDK).
- `model_dump(by_alias=True)` converts Python snake_case back to camelCase aliases (`dueDate`, `missingInfo`, etc.).
- Injects `_reply_text` into the state dict for frontend display.

### Error Fallback

```python
# voice_service.py:243-248
except Exception as e:
    print(f"Gemini Interaction Error: {e}")
    fallback_text = "Desculpe, tive um problema técnico. Pode repetir?"
    fallback_audio = self.generate_speech(fallback_text)
    return current_state, fallback_audio
```

- On any error: returns the **unchanged** `current_state` + TTS of the fallback message.

---

## Section G: Backend — TTS Pipeline

**Source:** `backend/app/services/voice_service.py`

### TTS Generation

```python
# voice_service.py:137-169
def generate_speech(self, text: str) -> Optional[bytes]:
    clean_text = text.replace('\n', ' ').strip()
    if not clean_text:
        return None
    
    response = self.client.models.generate_content(
        model=self.tts_model,
        contents=[types.Part(text=clean_text)],
        config=types.GenerateContentConfig(
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Puck"
                    )
                )
            )
        )
    )
    
    if response.candidates and response.candidates[0].content.parts:
        part = response.candidates[0].content.parts[0]
        audio_bytes = part.inline_data.data
        return self._pcm_to_wav(audio_bytes)
    
    return None
```

| Parameter | Value |
|---|---|
| Model | `gemini-2.5-flash-preview-tts` |
| Voice | `Puck` |
| Response Modality | `AUDIO` |
| Raw Output | PCM bytes from `part.inline_data.data` |

### PCM to WAV Conversion

```python
# voice_service.py:126-135
@staticmethod
def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 24000) -> bytes:
    """Wraps raw PCM data in a valid WAV header (16-bit, Mono)."""
    with io.BytesIO() as wav_io:
        with wave.open(wav_io, 'wb') as wav_file:
            wav_file.setnchannels(1)       # Mono
            wav_file.setsampwidth(2)       # 16-bit
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_bytes)
        return wav_io.getvalue()
```

| Parameter | Value |
|---|---|
| Sample Rate | `24000 Hz` |
| Channels | `1` (Mono) |
| Sample Width | `2` bytes (16-bit) |
| Format | WAV (RIFF header wrapping raw PCM) |

### Warmup & Greeting Generation

```python
# voice_service.py:90-124
def warmup_tts(self):
    # 1. Silent warmup call
    self.client.models.generate_content(
        model=self.tts_model,
        contents="Warmup",
        config=types.GenerateContentConfig(
            response_modalities=[types.Modality.AUDIO],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Puck"
                    )
                )
            )
        )
    )

    # 2. Generate welcome file if missing
    if not os.path.exists("welcome_fixed.wav"):
        greeting_text = "Olá! Sou o assistente de tarefas do Vikunja. Como posso ajudar você hoje?"
        audio_bytes = self.generate_speech(greeting_text)
        if audio_bytes:
            with open("welcome_fixed.wav", "wb") as f:
                f.write(audio_bytes)
```

- **Greeting text:** `"Olá! Sou o assistente de tarefas do Vikunja. Como posso ajudar você hoje?"`
- **File path:** `welcome_fixed.wav` (CWD-relative, typically project root)

---

## Section H: Backend — Glossary System

**Source:** `backend/app/services/task_processor.py` (class `GlossaryManager`), `glossary.json` (project root)

### GlossaryManager Class

```python
# task_processor.py:15-55
class GlossaryManager:
    def __init__(self, file_path: str = "data/glossary.json"):
        self.file_path = file_path
        self.seed_data = {
            "Hankell": ["Rankel", "Ranquel", "Hanke", "Rank", "Hankel", "Hanquel"],
            "Cenize": ["Senize", "Semize", "Zenize"],
            "Roquelina": ["Rock", "Roque", "Roc", "Hock"],
            "APN": ["PN", "A pena", "Apn", "A.P.N."],
            "Intelbras": ["Inteoubras", "Intel", "Inteobras"],
            "Datatem": ["Data tem", "Dataten", "Data ten"],
            "Odoo": ["Odo", "Hoodoo", "Odum"]
        }
        os.makedirs(os.path.dirname(self.file_path), exist_ok=True)
        if not os.path.exists(self.file_path):
            self.save(self.seed_data)
```

- **Default file path:** `data/glossary.json` (relative to CWD)
- **Seed entries:** 7 terms (Hankell, Cenize, Roquelina, APN, Intelbras, Datatem, Odoo)
- Auto-creates `data/` directory and seeds file if missing.

### Prompt Rule Generation

```python
# task_processor.py:49-55
def get_prompt_rules(self) -> str:
    data = self.load()
    rules = []
    for correct, variations in data.items():
        vars_str = ", ".join(variations)
        rules.append(f"- Se ouvir: {vars_str} -> Escreva: {correct}")
    return "\n".join(rules)
```

**Example output:**
```
- Se ouvir: Rankel, Ranquel, Hanke, Rank, Hankel, Hanquel -> Escreva: Hankell
- Se ouvir: Senize, Semize, Zenize -> Escreva: Cenize
- Se ouvir: Rock, Roque, Roc, Hock -> Escreva: Roquelina
...
```

### Root-Level glossary.json (Current Content)

```json
{
    "Hankell": ["Rankel", "Ranquel", "Hanke", "Rank", "Hankel", "Hanquel"],
    "Cenize": ["Senize", "Semize", "Zenize"],
    "Roquelina": ["Rock", "Roque", "Roc", "Hock"],
    "APN": ["PN", "A pena", "Apn", "A.P.N."],
    "Intelbras": ["Inteoubras", "Intel", "Inteobras"],
    "Datatem": ["Data tem", "Dataten", "Data ten"],
    "Odoo": ["Odo", "Hoodoo", "Odum"],
    "Lead": ["Leade"],
    "Leads": ["Leades", "Grandsteam"],
    "Grandstream": ["Gstam"]
}
```

- **10 entries** — 3 more than the seed data (Lead, Leads, Grandstream were added at runtime or manually).

---

## Section I: Backend — Pydantic Models & Contracts

**Source:** `backend/app/services/voice_service.py` (lines 17-32)

### ClarificationStrike

```python
# voice_service.py:17-19
class ClarificationStrike(BaseModel):
    field: str
    count: int
```

### VoiceTaskState

```python
# voice_service.py:21-28
class VoiceTaskState(BaseModel):
    title: str | None = None
    description: str | None = None
    due_date: str | None = Field(None, alias="dueDate")
    assignee: str | None = None
    status: str = "Em Progresso"
    missing_info: list[str] = Field(default_factory=lambda: ['title', 'description', 'dueDate', 'assignee'], alias="missingInfo")
    clarification_strikes: list[ClarificationStrike] = Field(default_factory=list, alias="clarificationStrikes")
```

| Field | Type | Default | Alias |
|---|---|---|---|
| `title` | `str \| None` | `None` | — |
| `description` | `str \| None` | `None` | — |
| `due_date` | `str \| None` | `None` | `dueDate` |
| `assignee` | `str \| None` | `None` | — |
| `status` | `str` | `"Em Progresso"` | — |
| `missing_info` | `list[str]` | `['title', 'description', 'dueDate', 'assignee']` | `missingInfo` |
| `clarification_strikes` | `list[ClarificationStrike]` | `[]` | `clarificationStrikes` |

### VoiceGeminiResponse

```python
# voice_service.py:30-32
class VoiceGeminiResponse(BaseModel):
    reply_text: str = Field(..., alias="replyText")
    updated_task: VoiceTaskState = Field(..., alias="updatedTask")
```

- This model is passed as `response_schema` to Gemini, enforcing structured JSON output.

---

## Section J: Environment & Configuration

**Source:** `backend/app/core/config.py`

```python
# config.py:4-13
class Settings(BaseSettings):
    GOOGLE_API_KEY: str
    VIKUNJA_API_TOKEN: str
    VIKUNJA_API_URL: str

    class Config:
        env_file = "../.env"
        extra = "ignore"
```

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_API_KEY` | Yes | Gemini API key for NLU + TTS |
| `VIKUNJA_API_TOKEN` | Yes | Vikunja instance auth token |
| `VIKUNJA_API_URL` | Yes | Vikunja instance base URL |

**Frontend env:**

| Variable | Required | Default |
|---|---|---|
| `VITE_API_URL` | No | `http://localhost:8000/api/v1` |

**Env file location:** `../.env` relative to `backend/` directory (i.e., project root `.env`).

---

## Section K: Known Anomalies

These are **facts about the current system**, not bugs to fix. They are documented here so any future work can account for them.

### K.1: MIME Type Mismatch (Frontend Audio Capture)

- **Location:** `frontend/src/components/voice/VoiceControls.tsx:17,28`
- **Issue:** `MediaRecorder` is instantiated with no options. The browser picks its default codec:
  - Chrome: `audio/webm;codecs=opus`
  - Firefox: `audio/ogg;codecs=opus`
- The resulting chunks are concatenated into a Blob labeled `{ type: 'audio/wav' }`, but the actual bytes are **webm/opus** (or ogg/opus), not WAV.
- The FormData sends this as `'input.wav'` filename.
- **Impact:** Gemini's `generate_content` API appears to handle this gracefully — it auto-detects the actual audio format regardless of the declared MIME type. The system works despite the mismatch.

### K.2: Glossary Dual File Location

- **Location:** `backend/app/services/task_processor.py:17`, `glossary.json` (project root)
- **Issue:** `GlossaryManager` defaults to `data/glossary.json` (relative path). A separate `glossary.json` exists at project root with 3 additional entries (Lead, Leads, Grandstream).
- **Impact:** Which file is loaded depends on the CWD when the backend starts. If the backend is started from the project root, `data/glossary.json` is used (or created from seed data). The root `glossary.json` is a V1 artifact and is **not** read by the Standard Agent unless CWD is explicitly set to load it.

### K.3: State Schema Default Mismatch

- **Location:** `frontend/src/store/useVoiceStore.ts:37` vs `backend/app/services/voice_service.py:26`
- **Issue:** Frontend `INITIAL_TASK_STATE.status` = `'draft'`. Backend `VoiceTaskState.status` default = `'Em Progresso'`.
- **Impact:** Functionally harmless. The first Gemini response overwrites the status field. The frontend `'draft'` value is sent in the first turn's `state` JSON, but Gemini returns `'Em Progresso'` in its response, which becomes the new state going forward.

### K.4: No Explicit Audio Constraints

- **Location:** `frontend/src/components/voice/VoiceControls.tsx:16`
- **Issue:** `getUserMedia({ audio: true })` uses browser defaults for sample rate, channel count, bit depth, echo cancellation, and noise suppression. No explicit constraints are set.
- **Impact:** Audio quality and characteristics vary by browser and device. This has not caused issues in practice.

---

## Appendix: Quick-Reference Configuration Table

| # | Configuration | Current Value | Source File:Line |
|---|---|---|---|
| 1 | NLU Model ID | `gemini-3-flash-preview` | `voice_service.py:88` |
| 2 | TTS Model ID | `gemini-2.5-flash-preview-tts` | `voice_service.py:86` |
| 3 | TTS Voice Name | `Puck` | `voice_service.py:103` |
| 4 | TTS Output Sample Rate | `24000 Hz` | `voice_service.py:127` |
| 5 | TTS Output Format | Mono, 16-bit PCM in WAV | `voice_service.py:127-135` |
| 6 | NLU Temperature | `0.6` | `voice_service.py:218` |
| 7 | NLU top_p | `0.95` | `voice_service.py:219` |
| 8 | NLU top_k | `40` | `voice_service.py:220` |
| 9 | NLU max_output_tokens | `1500` | `voice_service.py:217` |
| 10 | NLU response_mime_type | `application/json` | `voice_service.py:222` |
| 11 | NLU response_schema | `VoiceGeminiResponse` (Pydantic) | `voice_service.py:223` |
| 12 | System Instruction | See Section F (full text) | `voice_service.py:35-79` |
| 13 | Per-Turn Prompt Template | See Section F (full text) | `voice_service.py:188-200` |
| 14 | Audio Input MIME to Gemini | `audio/wav` | `voice_service.py:210` |
| 15 | Frontend MediaRecorder options | None (browser defaults) | `VoiceControls.tsx:17` |
| 16 | Frontend Blob label | `audio/wav` | `VoiceControls.tsx:28` |
| 17 | FormData file field name | `file`, filename `input.wav` | `voice.ts:18` |
| 18 | FormData state field name | `state` | `voice.ts:19` |
| 19 | Greeting text | `"Olá! Sou o assistente..."` | `voice_service.py:114` |
| 20 | Greeting file path | `welcome_fixed.wav` (CWD) | `voice.py:25` |
| 21 | Glossary file path | `data/glossary.json` | `task_processor.py:17` |
| 22 | Fallback error text | `"Desculpe, tive um problema técnico. Pode repetir?"` | `voice_service.py:246` |
| 23 | Initial frontend task status | `draft` | `useVoiceStore.ts:37` |
| 24 | Backend default task status | `Em Progresso` | `voice_service.py:26` |
