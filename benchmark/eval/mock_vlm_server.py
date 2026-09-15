import asyncio
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any

app = FastAPI(title="Mock VLM Server for Benchmarking")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SIMULATED_LATENCY_MS = int(os.environ.get("MOCK_VLM_LATENCY_MS", "200"))

class PlanRequest(BaseModel):
    sanitizedDom: list = []
    taskInstruction: str = ""
    pageUrl: str = ""
    pageTitle: str = ""
    screenType: str = ""
    tokenTypes: list = []
    actionHistory: list = []
    uiBoxes: list = []
    redactedImage: str = None
    originalImage: str = None

@app.post("/agent/plan")
async def plan(request: PlanRequest):
    await asyncio.sleep(SIMULATED_LATENCY_MS / 1000.0)
    return {
        "actions": [{"action": "done", "reasoning": "Mock VLM: task benchmarked"}],
        "reasoning": "Benchmark mock response"
    }

@app.get("/")
def root():
    return {"message": "Mock VLM Server running", "latency_ms": SIMULATED_LATENCY_MS}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
