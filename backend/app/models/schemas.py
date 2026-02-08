from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional

# --- Common Models ---

class TaskBase(BaseModel):
    model_config = ConfigDict(extra='forbid')
    
    title: str = Field(..., description="Actionable title (Verb + Object)")
    description: Optional[str] = Field(None, description="Full context/description")
    assignee_name: Optional[str] = Field(None, description="Raw name extracted from text")
    assignee_id: Optional[int] = Field(None, description="Vikunja User ID (resolved)")
    priority: int = Field(1, ge=1, le=5, description="Priority level 1-5")
    due_date: Optional[str] = Field(None, description="ISO Format YYYY-MM-DD")

# --- Response Models ---

class AnalysisResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    
    tasks: List[TaskBase]
    token_count: int
    processing_time: float
    file_count: int = 1
    file_names: List[str] = []

# --- Sync Models ---

class SyncRequest(BaseModel):
    tasks: List[TaskBase]

class SyncDetail(BaseModel):
    title: str
    status: str # 'success' or 'error'
    error: Optional[str] = None

class SyncResponse(BaseModel):
    total: int
    success: int
    failed: int
    details: List[SyncDetail]

# --- History Models ---

class HistorySummary(BaseModel):
    id: str
    timestamp: str
    source_files: List[str]
    file_count: int
    task_count: int
    model_used: str

class AnalysisDetail(BaseModel):
    tasks: List[TaskBase]

class HistoryDetail(BaseModel):
    id: str
    timestamp: str
    source_files: List[str]
    file_count: int
    model_used: str
    token_count: int
    processing_time: float
    analysis: AnalysisDetail
