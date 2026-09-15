from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from app.schemas.agent import AgentRequest, AgentAction, AgentPlan
from app.services.vlm_service import get_action_plan_from_vlm
import json

router = APIRouter()

def print_request_details(request: AgentRequest):
    print(f"\n=======================================================")
    print(f"[FastAPI] Incoming request: '{request.taskInstruction}'")
    print(f"Page: {request.pageTitle} ({request.pageUrl})")
    print(f"Sanitized DOM elements: {len(request.sanitizedDom)}")
    print(f"Token Types: {request.tokenTypes}")
    import os
    if os.environ.get("AGENT_DEBUG") == "1":
        print(f"=======================================================")
        print(f"DETAILED SANITIZED PAYLOAD RECEIVED FROM EXTENSION:")
        print(json.dumps(request.sanitizedDom, indent=2))
        print(f"=======================================================\n")

@router.websocket("/ws/plan")
async def websocket_plan(websocket: WebSocket):
    await websocket.accept()
    print("[FastAPI] WebSocket connection established for /ws/plan")
    try:
        while True:
            data = await websocket.receive_text()
            try:
                request_dict = json.loads(data)
                request = AgentRequest(**request_dict)
                print_request_details(request)
                
                plan = await get_action_plan_from_vlm(request)
                print(f"[VLM Output Plan] {len(plan.actions)} actions planned.")
                
                await websocket.send_json(plan.dict())
            except WebSocketDisconnect:
                print("[FastAPI] WebSocket disconnected during request processing.")
                break
            except Exception as e:
                print(f"[Error processing WS message] {e}")
                try:
                    await websocket.send_json({"error": str(e)})
                except Exception:
                    break
    except WebSocketDisconnect:
        print("[FastAPI] WebSocket connection closed cleanly")
    except Exception as e:
        print(f"[FastAPI] WebSocket connection terminated: {e}")

@router.post("/action", response_model=AgentAction)
async def get_next_action(request: AgentRequest):
    print_request_details(request)
    try:
        plan = await get_action_plan_from_vlm(request)
        action = plan.actions[0] if plan.actions else AgentAction(action="done", reasoning="No actions found")
        print(f"[VLM Output (Action fallback)] Action: {action.action} | Target: {action.target} | Value: {action.value}")
        print(f"[Reasoning] {action.reasoning}\n")
        return action
    except Exception as e:
        print(f"[Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/plan", response_model=AgentPlan)
async def get_action_plan(request: AgentRequest):
    print_request_details(request)
    try:
        plan = await get_action_plan_from_vlm(request)
        print(f"[VLM Output Plan] {len(plan.actions)} actions planned.")
        for a in plan.actions:
            print(f"  - Action: {a.action} | Target: {a.target} | Value: {a.value}")
        print(f"[Reasoning] {plan.reasoning}\n")
        return plan
    except Exception as e:
        print(f"[Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))

