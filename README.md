# 📝 MeetingToVikunja

**Turn messy meetings into actionable Vikunja tasks — via file upload, voice conversation, or real-time audio — powered by Google Gemini AI.**

## 📖 Overview

**MeetingToVikunja** is a full-stack application that bridges the gap between **meetings** and your **task management system** ([Vikunja](https://vikunja.io/)). It offers three distinct modes of operation:

| Mode | Description | How It Works |
|---|---|---|
| **Batch Processing** | Upload transcript files and extract tasks in bulk | File upload → Gemini analysis → editable task table → sync |
| **Standard Voice Agent** | Turn-based voice assistant for task creation | Record → transcribe → NLU → TTS response → draft task |
| **Live Voice Agent** | Full-duplex real-time conversation with Gemini | Continuous mic stream ↔ Gemini Live API ↔ real-time audio + tool calls |

Unlike generic summarizers, this tool uses a **High-Recall Prompting Strategy** to ensure no task is left behind, regardless of how fragmented or informal the conversation was. It features a custom **Phonetic Glossary** to correct Speech-to-Text errors specific to your business domain.

### ✨ Key Features

- **🧠 High-Recall Extraction:** Optimized prompts designed to extract 100% of actionable items from long transcripts, consolidating duplicates without losing context.
- **🎙️ Standard Voice Agent:** Turn-based voice interaction with Gemini for guided task creation — record a message, get a spoken response, and watch the task draft update in real-time.
- **⚡ Live Voice Agent (Full Duplex):** Real-time bidirectional audio conversation with Gemini Live API. Speak naturally and the AI extracts task fields on-the-fly via tool calling.
- **🗣️ Contextual Noise Filtering:** Aggressively filters filler words, personal chit-chat, and STT hallucinations.
- **📚 Dynamic Phonetic Glossary:** Editable knowledge base to fix recurring STT errors (e.g., "Rock" → "Roquelina", "PN" → "APN").
- **📂 Multi-File Support:** Handles fragmented meetings (e.g., `part1.mp3`, `part2.mp3`) as a continuous event.
- **� Smart User Mapping:** Fuzzy matching links names mentioned in audio to real Vikunja User IDs.
- **🔄 One-Click Sync:** Send extracted tasks directly to Vikunja with a single click.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + TypeScript)                   │
│  ├── /batch          Batch Processing View              │
│  └── /voice          Voice Agent View                   │
│       ├── Standard   VoiceControls + ChatInterface      │
│       └── Live       LiveControls + LiveChatInterface   │
├─────────────────────────────────────────────────────────┤
│  Backend (FastAPI + Python)                             │
│  ├── POST /api/v1/analyze         Batch analysis        │
│  ├── POST /api/v1/voice/*         Standard voice agent  │
│  └── WS   /api/v1/voice/live      Live voice agent      │
├─────────────────────────────────────────────────────────┤
│  External Services                                      │
│  ├── Google Gemini API (multiple models)                │
│  └── Vikunja API (task management)                      │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, Zustand, Lucide Icons |
| **Backend** | Python, FastAPI, WebSockets, google-genai SDK |
| **AI Models** | Gemini 3 Flash (NLU/Batch), Gemini 2.5 Flash TTS, Gemini 2.5 Flash Native Audio (Live) |
| **Task Sync** | Vikunja REST API |

### Gemini Models Used

| Purpose | Model ID |
|---|---|
| Batch Processing (text analysis) | `gemini-3-flash-preview` |
| Standard Agent — NLU | `gemini-3-flash-preview` |
| Standard Agent — TTS | `gemini-2.5-flash-preview-tts` |
| Live Agent (audio + tool calling) | `gemini-2.5-flash-native-audio-preview-12-2025` |

## 🛠️ Installation

### Prerequisites

- **Python 3.10+**
- **Node.js 18+** and **npm**
- A self-hosted [Vikunja](https://vikunja.io/) instance (or cloud account)
- A [Google AI Studio](https://aistudio.google.com/) API Key

### Steps

1. **Clone the repository:**
```bash
git clone https://github.com/cossil/meeting-to-vikunja_voice.git
cd meeting-to-vikunja_voice
```

2. **Configure environment:**
```bash
cp .env.template .env
```
Edit `.env` with your credentials:
```ini
VIKUNJA_API_URL=https://your-vikunja-instance.com/api/v1
VIKUNJA_API_TOKEN=your_vikunja_token
TARGET_PROJECT_ID=2
GOOGLE_API_KEY=your_google_gemini_key
```

3. **Install and start the backend:**
```bash
cd backend
pip install -r ../requirements.txt
uvicorn app.main:app --reload --port 8000
```

4. **Install and start the frontend** (new terminal):
```bash
cd frontend
npm install
npm run dev
```

5. **Open the app** at [http://localhost:5173](http://localhost:5173).

## 🚀 Usage

### Batch Processing (`/batch`)

1. **Select Date:** Choose the meeting date (crucial for relative dates like "next Friday").
2. **Upload:** Drag & drop transcript files (`.txt`, `.md`, `.csv`).
3. **Instruction (Optional):** Add context (e.g., "Ignore the discussion about the coffee machine").
4. **Review:** Edit the AI-generated task table inline — titles, assignees, priorities.
5. **Sync:** Click "Synchronize" to send tasks to Vikunja.

### Standard Voice Agent (`/voice` → Padrão)

1. Click the **microphone button** or type a message.
2. The agent responds with voice and text, extracting task fields as you speak.
3. Review the **Task Draft** panel on the right.
4. Click **"Criar Tarefa"** to sync to Vikunja.

### Live Voice Agent (`/voice` → Tempo Real)

1. Switch to **"Tempo Real"** mode using the toggle in the header.
2. Click **"Conectar ao Gemini Live"** to start a full-duplex session.
3. Speak naturally — the AI listens and responds in real-time.
4. Task fields update automatically via Gemini tool calling.
5. Click **"Criar Tarefa"** when the draft is complete.

## ⚙️ Advanced Configuration

### The Glossary (`glossary.json`)

The glossary maps phonetic errors to correct entities and is injected into all AI prompts:

- **Key:** The correct term (e.g., "Hankell").
- **Values:** Common STT errors (e.g., "Rankel", "Hanquel", "Rank").

Manage it via the UI or edit `glossary.json` directly.

## 📁 Project Structure

```
meeting-to-vikunja/
├── backend/
│   └── app/
│       ├── api/endpoints/       # batch.py, voice.py, live.py
│       ├── core/                # config, settings
│       ├── models/              # Pydantic schemas
│       └── services/            # Business logic
│           ├── task_processor.py     # Batch analysis
│           ├── voice_service.py      # Standard voice agent
│           ├── live_session.py       # Live voice agent (WS proxy)
│           ├── vikunja_client.py     # Vikunja API client
│           └── vikunja_service.py    # Sync orchestration
├── frontend/
│   └── src/
│       ├── api/                 # HTTP + WS clients
│       ├── components/          # UI components (shadcn/ui)
│       │   └── voice/           # Voice-specific components
│       ├── store/               # Zustand stores
│       ├── utils/               # Audio processing utilities
│       └── views/               # Page-level views
├── Docs/                        # Plans, reports, specs
├── glossary.json                # Phonetic correction dictionary
├── .env.template                # Environment variable template
└── requirements.txt             # Python dependencies
```

## 🤝 Contributing

Contributions are welcome! If you want to add support for other task managers (Jira, Trello, Notion) or improve the AI logic:

1. Fork the project.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

**Disclaimer:** This tool relies on Generative AI. Always review the extracted tasks before syncing them to your production environment.