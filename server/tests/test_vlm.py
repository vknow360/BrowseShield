import asyncio

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.agent import AgentRequest, AgentAction, AgentPlan
from app.services import vlm_service
from app.services.vlm_service import build_user_prompt

client = TestClient(app)


# --------------------------------------------------------------------------- #
# Prompt construction
# --------------------------------------------------------------------------- #
def test_build_user_prompt():
    req = AgentRequest(
        sanitizedDom=[
            {"tagName": "input", "label": "Full Name", "value": "[[PERSON_1]]", "selector": "#name", "type": "text"}
        ],
        pageUrl="http://localhost:3000/healthcare",
        pageTitle="Healthcare Portal",
        screenType="form",
        taskInstruction="Fill out this form",
        tokenTypes=["PERSON"],
    )
    prompt = build_user_prompt(req)

    assert "<USER_TASK>" in prompt
    assert "Fill out this form" in prompt
    assert "Healthcare Portal" in prompt
    assert "Screen type: form" in prompt
    assert "[[PERSON_1]]" in prompt
    assert "Image provided: No" in prompt


def test_build_user_prompt_with_image():
    req = AgentRequest(
        taskInstruction="Submit",
        redactedImage="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD",
    )
    prompt = build_user_prompt(req)
    assert "Image provided: Yes (redacted)" in prompt


# --------------------------------------------------------------------------- #
# Ollama interaction (mocked httpx so no real model is required)
# --------------------------------------------------------------------------- #
class _Resp:
    def __init__(self, status_code=200, data=None, text=""):
        self.status_code = status_code
        self._data = data or {}
        self.text = text

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"status {self.status_code}")


def _fake_client_factory(captured, chat_content='{"action":"click","target":"#go","reasoning":"ok"}'):
    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, timeout=None):
            return _Resp(200, {"models": [{"name": "qwen2.5-vl:3b"}]})

        async def post(self, url, json=None, timeout=None, **kwargs):
            captured["payload"] = json
            return _Resp(200, {"message": {"content": chat_content}})

    return _FakeClient


def test_redacted_image_is_sent_to_ollama(monkeypatch):
    captured = {}
    monkeypatch.setattr(vlm_service.httpx, "AsyncClient", _fake_client_factory(captured))

    req = AgentRequest(taskInstruction="Submit", redactedImage="data:image/jpeg;base64,QUJD")
    plan = asyncio.run(vlm_service.get_action_plan_from_vlm(req))

    assert isinstance(plan, AgentPlan)
    user_msg = captured["payload"]["messages"][-1]
    assert user_msg["role"] == "user"
    assert user_msg["content"][1]["type"] == "image_url"
    assert user_msg["content"][1]["image_url"]["url"] == "data:image/jpeg;base64,QUJD"


def test_no_image_means_no_images_field(monkeypatch):
    captured = {}
    monkeypatch.setattr(vlm_service.httpx, "AsyncClient", _fake_client_factory(captured))

    req = AgentRequest(taskInstruction="Submit")
    asyncio.run(vlm_service.get_action_plan_from_vlm(req))

    assert "images" not in captured["payload"]["messages"][-1]


def test_mock_fallback_when_ollama_unreachable(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(vlm_service.httpx, "AsyncClient", boom)

    import pytest
    with pytest.raises(ValueError, match="VLM server unreachable"):
        asyncio.run(vlm_service.get_action_plan_from_vlm(AgentRequest(taskInstruction="Fill")))


# --------------------------------------------------------------------------- #
# HTTP endpoint
# --------------------------------------------------------------------------- #
def test_action_endpoint_returns_valid_action(monkeypatch):
    async def fake_vlm(req):
        return AgentPlan(actions=[AgentAction(action="done", reasoning="Task completed")], reasoning="Done")

    monkeypatch.setattr("app.api.agent_router.get_action_plan_from_vlm", fake_vlm)

    res = client.post("/agent/action", json={"taskInstruction": "finish"})
    assert res.status_code == 200
    body = res.json()
    assert body["action"] == "done"
    assert "reasoning" in body


def test_action_endpoint_surfaces_errors(monkeypatch):
    async def boom(req):
        raise ValueError("bad model output")

    monkeypatch.setattr("app.api.agent_router.get_action_plan_from_vlm", boom)

    res = client.post("/agent/action", json={"taskInstruction": "finish"})
    assert res.status_code == 500
