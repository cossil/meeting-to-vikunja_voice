import json
import asyncio
import logging
import websockets
import base64
from fastapi import WebSocket, WebSocketDisconnect
from app.core.config import settings
from app.services.glossary_manager import GlossaryManager

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
            async with websockets.connect(
                self.uri,
                ping_interval=20,
                ping_timeout=20,
                max_size=2**24,  # 16MB — generous for audio chunks
            ) as google_ws:
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

                # 3. Start Bidirectional Loop + Heartbeat
                results = await asyncio.gather(
                    self.client_to_google(client_ws, google_ws),
                    self.google_to_client(google_ws, client_ws),
                    self._heartbeat(client_ws),
                    return_exceptions=True,
                )
                for r in results:
                    if isinstance(r, Exception):
                        logger.error("Bidirectional loop task failed: %s", r, exc_info=r)
        except websockets.exceptions.ConnectionClosed as e:
            logger.warning("Gemini WS closed: %s", e)
        except Exception as e:
            logger.error("Live session error: %s", e, exc_info=True)
        finally:
            try:
                await client_ws.close()
            except Exception:
                pass

    async def _safe_send_json(self, client_ws: WebSocket, data: dict) -> bool:
        """Send JSON to client, returning False if the client is gone."""
        try:
            await client_ws.send_json(data)
            return True
        except Exception as e:
            logger.warning("Failed to send JSON to client: %s", e)
            return False

    async def _safe_send_bytes(self, client_ws: WebSocket, data: bytes) -> bool:
        """Send binary to client, returning False if the client is gone."""
        try:
            await client_ws.send_bytes(data)
            return True
        except Exception as e:
            logger.warning("Failed to send bytes to client: %s", e)
            return False

    async def _heartbeat(self, client_ws: WebSocket, interval: int = 15):
        """Send periodic pings to keep the client↔backend WS alive."""
        try:
            while True:
                await asyncio.sleep(interval)
                if not await self._safe_send_json(client_ws, {"type": "ping"}):
                    break  # Client gone, stop heartbeat
        except asyncio.CancelledError:
            pass
        except Exception:
            pass  # Connection closed, heartbeat naturally stops

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

    async def _process_tool_call(self, fn: dict, client_ws: WebSocket, google_ws) -> None:
        """Process a single Gemini function call with defensive parsing."""
        fn_name = fn.get("name") or "unknown"
        fn_args = fn.get("args") or {}
        fn_id = fn.get("id") or ""

        # Ensure args is a dict (Gemini could send None or a string)
        if not isinstance(fn_args, dict):
            logger.warning("Tool call args is not a dict: %s (type=%s)", fn_args, type(fn_args))
            fn_args = {}

        # Type-coerce priority to int if present (Gemini may send as string or float)
        if "priority" in fn_args:
            try:
                fn_args["priority"] = int(fn_args["priority"])
            except (ValueError, TypeError):
                logger.warning("Invalid priority value, removing: %s", fn_args["priority"])
                fn_args.pop("priority")

        logger.info("Tool call: %s (id=%s) args=%s", fn_name, fn_id, fn_args)

        if fn_name == "update_task_draft":
            await self._safe_send_json(client_ws, {"type": "task_update", "data": fn_args})

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

    async def google_to_client(self, google_ws: websockets.WebSocketClientProtocol, client_ws: WebSocket):
        """Route Gemini responses to the client: audio (binary), tool calls, transcripts, turn events."""
        try:
            async for raw_msg in google_ws:
                try:
                    msg = json.loads(raw_msg)
                except (json.JSONDecodeError, TypeError) as e:
                    logger.warning("Non-JSON message from Gemini (len=%s): %s", len(raw_msg) if raw_msg else 0, e)
                    continue

                # --- Tool Calls (top-level, NOT inside serverContent) ---
                tool_call = msg.get("toolCall")
                if tool_call:
                    for fn in tool_call.get("functionCalls", []):
                        try:
                            await self._process_tool_call(fn, client_ws, google_ws)
                        except Exception as e:
                            logger.error("Error processing tool call '%s': %s", fn.get("name", "?"), e, exc_info=True)
                            # Send fallback tool response to unblock Gemini
                            try:
                                fallback = {
                                    "tool_response": {
                                        "function_responses": [{
                                            "id": fn.get("id") or "",
                                            "name": fn.get("name") or "unknown",
                                            "response": {"result": "error", "error": str(e)}
                                        }]
                                    }
                                }
                                await google_ws.send(json.dumps(fallback))
                            except Exception:
                                pass
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
                        if "inlineData" in part:
                            try:
                                audio_b64 = part["inlineData"].get("data", "")
                                if audio_b64:
                                    if not await self._safe_send_bytes(client_ws, base64.b64decode(audio_b64)):
                                        return  # Client gone
                            except Exception as e:
                                logger.warning("Failed to decode/send audio chunk: %s", e)

                # --- Transcription events ---
                input_transcript = server_content.get("inputTranscription")
                if input_transcript:
                    await self._safe_send_json(client_ws, {
                        "type": "transcript",
                        "source": "user",
                        "text": input_transcript.get("text", ""),
                        "isComplete": False,
                    })

                output_transcript = server_content.get("outputTranscription")
                if output_transcript:
                    await self._safe_send_json(client_ws, {
                        "type": "transcript",
                        "source": "model",
                        "text": output_transcript.get("text", ""),
                        "isComplete": False,
                    })

                # --- Turn lifecycle events ---
                if server_content.get("turnComplete"):
                    await self._safe_send_json(client_ws, {"type": "turn_complete"})

                if server_content.get("interrupted"):
                    await self._safe_send_json(client_ws, {"type": "interrupted"})

        except websockets.exceptions.ConnectionClosed as e:
            logger.info("Gemini WS closed in google_to_client: code=%s reason=%s", e.code, e.reason)
            # C1: Send a typed close reason to the client
            reason = "Gemini session ended"
            if e.code == 1000:
                reason = "Gemini session completed normally"
            elif e.code == 1001:
                reason = "Gemini server going away"
            await self._safe_send_json(client_ws, {"type": "error", "message": reason})
        except Exception as e:
            logger.error("Error in google_to_client: %s", e, exc_info=True)
            await self._safe_send_json(client_ws, {"type": "error", "message": str(e)})
