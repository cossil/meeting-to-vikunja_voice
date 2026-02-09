import os
import re
import json
import docx
import shutil
import time
import logging
from typing import List, Dict, Optional, Any
from datetime import datetime
from google import genai
from google.genai import types
from thefuzz import process
from fastapi import UploadFile
from app.core.config import settings
from app.models.schemas import AnalysisResponse, TaskBase
from app.services.glossary_manager import GlossaryManager

logger = logging.getLogger(__name__)

def get_system_prompt(meeting_date_str: str, custom_instructions: str, glossary_rules: str) -> str:
    return f"""Você é um Analista Sênior de Projetos e Atas.
        Sua missão é transformar uma transcrição crua (que pode ser a união de vários arquivos de áudio contendo erros de digitação, gírias e conversas paralelas) em tarefas profissionais e acionáveis.

        CONTEXTO DE ENTRADA:
        1. Data da Reunião: {meeting_date_str}
        2. Instruções do Usuário: "{custom_instructions}"
        3. Origem: Consolidação de segmentos da MESMA reunião.

        DIRETRIZES DE PROCESSAMENTO (PRIORIDADE MÁXIMA = EXAUSTIVIDADE):
        1. FILTRO DE RUÍDO: Identifique e exclua agressivamente vícios de linguagem ("né", "aham" , "sim mas"), conversas pessoais (almoço, banheiro, família, filhos, clima), pensamentos incompletos e digressões irrelevantes.
        2. NORMALIZAÇÃO 1: Corrija a gramática do STT. Transforme "eu vô vê isso" em "Analisar tópico X" ou "eu vô enviá o e-mail" em "Enviar e-mail".
        3. NORMALIZAÇÃO 2: Use as regras do glossário abaixo para corrigir nomes e termos técnicos:
        {glossary_rules}

        4. TAREFAS IMPLÍCITAS: Identifique compromissos ocultos (Ex: "Deixa que eu vejo isso" -> Tarefa: "Analisar tópico X").
        5. EXAUSTIVIDADE (CRÍTICO): Não deixe NENHUMA tarefa para trás. Se um assunto foi discutido e gerou uma ação, ele DEVE virar uma tarefa, mesmo que pareça menor. É melhor pecar pelo excesso do que pela falta.
        6. CONSOLIDAÇÃO INTELIGENTE: Identifique itens sobrepostos, e apenas unifique tarefas se elas forem ESTRITAMENTE sobre a mesma entrega.
        7. CONTINUIDADE: Trate o texto como um fluxo contínuo. Mesmo se o texto mudar de assunto bruscamente, continue a análise lógica.

        FORMATO DE SAÍDA (JSON):
        - title (string): Verbo + Objeto (Use termos corrigidos).
        - description (string): Contexto completo (Use termos corrigidos).
        - assignee_name (string): Nome corrigido.
        - priority (int): 1-5.
        - due_date (string): YYYY-MM-DD ou null.
        """

class TaskProcessor:
    def __init__(self):
        self.api_key = settings.GOOGLE_API_KEY
        self.client = genai.Client(api_key=self.api_key)
        self.model_id = "gemini-3-flash-preview"
        self.glossary_manager = GlossaryManager()

    async def extract_text_from_upload(self, file: UploadFile) -> str:
        ext = os.path.splitext(file.filename)[1].lower()
        
        # Save temp file to read
        temp_path = f"temp_{int(time.time())}_{file.filename}"
        try:
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            text = ""
            if ext == ".docx":
                doc = docx.Document(temp_path)
                text = "\n".join([p.text for p in doc.paragraphs])
            elif ext in [".txt", ".md"]:
                with open(temp_path, "r", encoding="utf-8") as f:
                    text = f.read()
            elif ext == ".vtt":
                with open(temp_path, "r", encoding="utf-8") as f:
                    raw = f.read()
                # Strip WebVTT header, timestamps, and blank lines — keep spoken text
                lines = []
                for line in raw.splitlines():
                    line = line.strip()
                    if not line or line == "WEBVTT" or re.match(r"^\d{2}:\d{2}", line) or line.startswith("NOTE"):
                        continue
                    lines.append(line)
                text = "\n".join(lines)
            return text
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Rough estimation of token count (approx 4 chars/token)."""
        return len(text) // 4

    async def process_file(self, file: UploadFile, meeting_date: Optional[datetime] = None, custom_instructions: str = "") -> AnalysisResponse:
        """Convenience wrapper — processes a single file via process_files."""
        if meeting_date is None:
            meeting_date = datetime.now()
        return await self.process_files([file], meeting_date, custom_instructions)

    async def process_files(self, files: List[UploadFile], meeting_date: Optional[datetime] = None, custom_instructions: str = "") -> AnalysisResponse:
        """Process one or more files as a single continuous meeting context."""
        if meeting_date is None:
            meeting_date = datetime.now()
        start_time = time.time()

        file_names: List[str] = []
        combined_text = ""

        for file in files:
            name = file.filename or "unknown"
            file_names.append(name)
            text = await self.extract_text_from_upload(file)
            if not text.strip():
                logger.warning("Empty content extracted from %s — skipping", name)
                continue
            if len(files) > 1:
                combined_text += f"\n\n--- INÍCIO DO ARQUIVO: {name} ---\n{text}\n--- FIM DO ARQUIVO: {name} ---\n"
            else:
                combined_text = text

        if not combined_text.strip():
            raise ValueError("Nenhum conteúdo extraído dos arquivos enviados.")

        glossary_rules = self.glossary_manager.get_prompt_rules()
        meeting_date_str = meeting_date.strftime('%d/%m/%Y (%A)')
        system_instructions = get_system_prompt(meeting_date_str, custom_instructions, glossary_rules)

        prompt = f"""
        {system_instructions}

        TRANSCRICÃO:
        ---
        {combined_text}
        ---
        """

        try:
            response = self.client.models.generate_content(
                model=self.model_id,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            data = json.loads(response.text)

            # Ensure data is a list
            if not isinstance(data, list):
                if isinstance(data, dict):
                    data = data.get('tasks', [data])
                else:
                    data = []

            tasks = []
            for item in data:
                try:
                    tasks.append(TaskBase(**item))
                except Exception as e:
                    logger.warning("Skipping invalid task: %s - %s", item, e)

            processing_time = time.time() - start_time
            return AnalysisResponse(
                tasks=tasks,
                token_count=self.estimate_tokens(combined_text),
                processing_time=processing_time,
                file_count=len(files),
                file_names=file_names,
            )

        except Exception as e:
            logger.error("Erro na análise do Gemini: %s", e)
            raise e
