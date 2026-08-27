from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.agent_router import router as agent_router

app = FastAPI(title="ShieldBrowse Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agent_router, prefix="/agent", tags=["Agent"])

@app.get("/")
def read_root():
    return {"message": "ShieldBrowse Server is running"}
