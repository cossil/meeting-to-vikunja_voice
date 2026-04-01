import logging
from typing import List
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from app.core.security import get_current_user
from app.models.auth_schemas import User
from app.models.schemas import AnalysisResponse, SyncRequest, SyncResponse, SyncDetail
from app.services.task_processor import TaskProcessor
from app.services.vikunja_service import VikunjaService
from app.services.history_manager import HistoryManager

logger = logging.getLogger(__name__)

router = APIRouter()
processor = TaskProcessor()
vikunja_service = VikunjaService()
history_manager = HistoryManager()

@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_meeting(
    files: List[UploadFile] = File(default=[]),
    text_context: str | None = Form(None),
    current_user: User = Depends(get_current_user),
):
    """
    Analyze one or more meeting transcript/notes files and extract tasks.
    Multiple files are treated as fragments of the same meeting.
    Alternatively, raw transcript text can be pasted via text_context.
    """
    try:
        has_files = bool(files and any(f.filename for f in files))
        has_text = bool(text_context and text_context.strip())

        if not has_files and not has_text:
            raise HTTPException(
                status_code=400,
                detail="Must provide either files or text context",
            )

        result = await processor.process_files(
            files if has_files else [],
            text_context=text_context if has_text else None,
        )

        # Phase 3c: Persist result (fire-and-forget, never blocks response)
        try:
            history_manager.save(result, owner_id=current_user.id)
        except Exception:
            logger.exception("History save failed — response unaffected")

        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync", response_model=SyncResponse)
async def sync_tasks(request: SyncRequest, current_user: User = Depends(get_current_user)):
    """
    Sync a list of tasks to Vikunja.
    """
    success_count = 0
    failed_count = 0
    details = []

    for task in request.tasks:
        try:
            result = await vikunja_service.create_task(task, created_by=current_user.username)
            if result:
                success_count += 1
                details.append(SyncDetail(title=task.title, status="success"))
            else:
                failed_count += 1
                details.append(SyncDetail(title=task.title, status="error", error="Failed to create task"))
        except Exception as e:
            failed_count += 1
            details.append(SyncDetail(title=task.title, status="error", error=str(e)))

    return SyncResponse(
        total=len(request.tasks),
        success=success_count,
        failed=failed_count,
        details=details
    )
