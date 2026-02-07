import json
import asyncio
import logging
import websockets
import base64
from fastapi import WebSocket, WebSocketDisconnect
from app.core.config import settings
from app.services.task_processor import GlossaryManager

logger = logging.getLogger(__name__)

GLOSSARY = GlossaryManager()

# ---------------------------------------------------------------------------
# Live Agent System Prompt (conversational, adapted from voice_service.py)
# Distinct from the batch-processing prompt in task_processor.py.
# ---------------------------------------------------------------------------
LIVE_SYSTEM_INSTRUCTION = """Você é o "Assistente de Tarefas". Sua missão é extrair informações de uma conversa por voz para criar uma "Ficha de Tarefa".
Fale APENAS em Português do Brasil (pt-BR).

**Sua Persona:**
- Humilde, prestativo, ansioso para aprender.
- Use frases como "Desculpe, não entendi...", "Só para confirmar...", "Anotei aqui...".
- NUNCA diga apenas "OK". Sempre reflita o que entendeu.
- Seja CONCISO. Use no máximo 2-3 frases curtas.

**Regras de Negócio:**
1. **The Two-Strike Rule**: Se o usuário fornecer informações pouco claras sobre um campo específico duas vezes, pare de perguntar e marque o campo como "A Revisar".
2. **Escuta Reflexiva**: Resuma brevemente o que já foi coletado.
3. **Golden Record**: Colete: Título, Descrição, Data de Vencimento, Responsável.
4. Use a ferramenta `update_task_draft` para atualizar a ficha sempre que coletar ou atualizar informações.

**Regras para Campos:**
- **Título**: MÁXIMO 6 PALAVRAS. Verbo + Objeto. Sem repetições.
- **Descrição**: Resumo objetivo (Max 150 caracteres).
- **Data de Vencimento**: Formato YYYY-MM-DD.
- **Prioridade**: 1 (Baixa) a 5 (Crítica).

{glossary_rules}
"""

# Tool Definition
update_task_draft_tool = {
    "function_declarations": [
        {
            "name": "update_task_draft",
            "description": "Updates the current draft of the task based on user voice input.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "title": {"type": "STRING", "description": "The title of the task."},
                    "description": {"type": "STRING", "description": "The description or notes for the task."},
                    "assignee": {"type": "STRING", "description": "Who is responsible for the task."},
                    "dueDate": {"type": "STRING", "description": "Due date in YYYY-MM-DD format."},
                    "priority": {"type": "INTEGER", "description": "Priority from 1 (Low) to 5 (Critical)."}
                },
                "required": ["title"]
            }
        }
    ]
}

class GeminiLiveSession:
    def __init__(self):
        self.api_key = settings.GOOGLE_API_KEY
        self.model = "gemini-2.5-flash-native-audio-preview-12-2025"
        self.host = "generativelanguage.googleapis.com"
        self.uri = (
            f"wss://{self.host}/ws/google.ai.generativelanguage."
            f"v1alpha.GenerativeService.BidiGenerateContent?key={self.api_key}"
        )

    async def start(self, client_ws: WebSocket):
        await client_ws.accept()

        # Build system prompt with glossary injection
        glossary_rules = GLOSSARY.get_prompt_rules()
        system_instruction = LIVE_SYSTEM_INSTRUCTION.format(glossary_rules=glossary_rules)

        # Connect to Gemini Live API
        try:
            async with websockets.connect(self.uri) as google_ws:
                # 1. Send Setup Message (matches reference config structure)
                setup_msg = {
                    "setup": {
                        "model": f"models/{self.model}",
                        "generation_config": {
                            "response_modalities": ["AUDIO"],
                            "speech_config": {
                                "voice_config": {
                                    "prebuilt_voice_config": {
                                        "voice_name": "Kore"
                                    }
                                }
                            },
                        },
                        "tools": [update_task_draft_tool],
                        "system_instruction": {
                            "parts": [{"text": system_instruction}]
                        },
                        "input_audio_transcription": {},
                        "output_audio_transcription": {},
                    }
                }
                await google_ws.send(json.dumps(setup_msg))

                # 2. Handshake response (Gemini acknowledges setup)
                first_msg = await google_ws.recv()
                logger.info("Gemini handshake received: %s", first_msg[:200] if isinstance(first_msg, str) else "<binary>")

                # 3. Start Bidirectional Loop
                await asyncio.gather(
                    self.client_to_google(client_ws, google_ws),
                    self.google_to_client(google_ws, client_ws),
                )
        except websockets.exceptions.ConnectionClosed as e:
            logger.warning("Gemini WS closed: %s", e)
        except Exception as e:
            logger.error("Live session error: %s", e, exc_info=True)
        finally:
            try:
                await client_ws.close()
            except Exception:
                pass

    async def client_to_google(self, client_ws: WebSocket, google_ws: websockets.WebSocketClientProtocol):
        """Forward client audio (binary) and control messages (JSON text) to Gemini."""
        try:
            while True:
                data = await client_ws.receive()

                if "bytes" in data:
                    # Binary frame = raw Int16 PCM from frontend mic
                    realtime_input = {
                        "realtime_input": {
                            "media_chunks": [{
                                "mime_type": "audio/pcm;rate=16000",
                                "data": base64.b64encode(data["bytes"]).decode("utf-8")
                            }]
                        }
                    }
                    await google_ws.send(json.dumps(realtime_input))

                elif "text" in data:
                    # Text frame = JSON control message from frontend
                    try:
                        msg = json.loads(data["text"])
                        msg_type = msg.get("type")
                        if msg_type == "stop":
                            logger.info("Client requested stop")
                            # Could send a cancel/stop signal to Gemini if supported
                    except json.JSONDecodeError:
                        logger.warning("Non-JSON text from client: %s", data["text"][:100])

        except WebSocketDisconnect:
            logger.info("Client disconnected")
        except Exception as e:
            logger.error("Error in client_to_google: %s", e)

    async def google_to_client(self, google_ws: websockets.WebSocketClientProtocol, client_ws: WebSocket):
        """Route Gemini responses to the client: audio (binary), tool calls, transcripts, turn events."""
        try:
            async for raw_msg in google_ws:
                msg = json.loads(raw_msg)

                # --- Tool Calls (top-level, NOT inside serverContent) ---
                # Per Gemini Live API spec: toolCall is a separate messageType
                # in BidiGenerateContentServerMessage, alongside serverContent.
                tool_call = msg.get("toolCall")
                if tool_call:
                    for fn in tool_call.get("functionCalls", []):
                        fn_name = fn.get("name")
                        fn_args = fn.get("args", {})
                        fn_id = fn.get("id", "")
                        logger.info("Tool call received: %s (id=%s) args=%s", fn_name, fn_id, fn_args)

                        if fn_name == "update_task_draft":
                            # Forward to client as task_update event
                            await client_ws.send_json({
                                "type": "task_update",
                                "data": fn_args
                            })

                        # Acknowledge tool call so Gemini continues the turn
                        tool_response = {
                            "tool_response": {
                                "function_responses": [{
                                    "id": fn_id,
                                    "name": fn_name,
                                    "response": {"result": "ok"}
                                }]
                            }
                        }
                        await google_ws.send(json.dumps(tool_response))
                    continue

                # --- Tool Call Cancellation (top-level) ---
                if msg.get("toolCallCancellation"):
                    logger.info("Tool call cancelled: %s", msg["toolCallCancellation"].get("ids", []))
                    continue

                server_content = msg.get("serverContent")
                if not server_content:
                    continue

                # --- Audio (from modelTurn) ---
                model_turn = server_content.get("modelTurn")
                if model_turn:
                    for part in model_turn.get("parts", []):
                        # Audio chunk → binary frame to client
                        if "inlineData" in part:
                            audio_b64 = part["inlineData"]["data"]
                            await client_ws.send_bytes(base64.b64decode(audio_b64))

                # --- Transcription events ---
                input_transcript = server_content.get("inputTranscription")
                if input_transcript:
                    await client_ws.send_json({
                        "type": "transcript",
                        "source": "user",
                        "text": input_transcript.get("text", ""),
                        "isComplete": False,
                    })

                output_transcript = server_content.get("outputTranscription")
                if output_transcript:
                    await client_ws.send_json({
                        "type": "transcript",
                        "source": "model",
                        "text": output_transcript.get("text", ""),
                        "isComplete": False,
                    })

                # --- Turn lifecycle events ---
                if server_content.get("turnComplete"):
                    await client_ws.send_json({"type": "turn_complete"})

                if server_content.get("interrupted"):
                    await client_ws.send_json({"type": "interrupted"})

        except websockets.exceptions.ConnectionClosed:
            logger.info("Gemini WS closed in google_to_client")
        except Exception as e:
            logger.error("Error in google_to_client: %s", e)
            try:
                await client_ws.send_json({"type": "error", "message": str(e)})
            except Exception:
                pass
