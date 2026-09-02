from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class AgentRequest(BaseModel):
    sanitizedDom: List[Dict[str, Any]] = []
    pageUrl: str = ""
    pageTitle: str = ""
    screenType: Optional[str] = "unknown"
    taskInstruction: str = "Fill out this form"
    redactedImage: Optional[str] = None
    tokenTypes: List[str] = []
    actionHistory: List[Dict[str, Any]] = []
    uiBoxes: List[Dict[str, Any]] = []

class AgentAction(BaseModel):
    action: str
    target: Optional[Any] = None
    value: Optional[str] = None
    reasoning: str = ""

class AgentPlan(BaseModel):
    actions: List[AgentAction]
    reasoning: str = ""

