from fastapi import APIRouter, HTTPException
from app.schemas.agent import AgentRequest, AgentAction
from app.services.vlm_service import get_next_action_from_vlm

router = APIRouter()

@router.post("/action", response_model=AgentAction)
async def get_next_action(request: AgentRequest):
    print(f"\n=======================================================")
    print(f"🔒 [FastAPI] Incoming request: '{request.taskInstruction}'")
    print(f"📄 Page: {request.pageTitle} ({request.pageUrl})")
    print(f"🧩 Sanitized DOM elements: {len(request.sanitizedDom)}")
    print(f"🏷️ Token Types: {request.tokenTypes}")
    print(f"=======================================================")
    try:
        action = await get_next_action_from_vlm(request)
        print(f"🤖 [VLM Output] Action: {action.action} | Target: {action.target} | Value: {action.value}")
        print(f"💡 [Reasoning] {action.reasoning}\n")
        return action
    except Exception as e:
        print(f"❌ [Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))
