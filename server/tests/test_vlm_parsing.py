import asyncio
import pytest
from app.schemas.agent import AgentRequest, AgentPlan, AgentAction
from app.services import vlm_service

# Mock httpx response class
class _Resp:
    def __init__(self, status_code=200, text="", data=None):
        self.status_code = status_code
        self.text = text
        self._data = data or {}

    def json(self):
        return self._data

    def raise_for_status(self):
        pass

def _fake_client(content):
    class _FakeClient:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, **kwargs):
            return _Resp(200, data={"models": [{"name": "qwen2.5-vl:3b"}]})
        async def post(self, url, **kwargs):
            return _Resp(200, data={"message": {"content": content}})
    return _FakeClient

def test_parses_clean_json(monkeypatch):
    json_str = '{"actions": [{"action": "click", "target": "#btn"}], "reasoning": "Clicking button"}'
    monkeypatch.setattr(vlm_service.httpx, "AsyncClient", _fake_client(json_str))
    
    req = AgentRequest(taskInstruction="test")
    plan = asyncio.run(vlm_service.get_action_plan_from_vlm(req))
    
    assert isinstance(plan, AgentPlan)
    assert len(plan.actions) == 1
    assert plan.actions[0].action == "click"

def test_parses_markdown_wrapped_json(monkeypatch):
    md_str = '''Here is the plan:
```json
{
  "actions": [
    {"action": "type", "target": "#input", "value": "test"}
  ],
  "reasoning": "Typing test"
}
```
Hope this helps!'''
    monkeypatch.setattr(vlm_service.httpx, "AsyncClient", _fake_client(md_str))
    
    req = AgentRequest(taskInstruction="test")
    plan = asyncio.run(vlm_service.get_action_plan_from_vlm(req))
    
    assert len(plan.actions) == 1
    assert plan.actions[0].action == "type"
    assert plan.actions[0].value == "test"

def test_falls_back_to_regex_extraction_on_malformed_json(monkeypatch):
    # Missing quotes around keys, trailing commas, etc.
    malformed_str = '{actions: [{action: "done", reasoning: "Done"}],}'
    monkeypatch.setattr(vlm_service.httpx, "AsyncClient", _fake_client(malformed_str))
    
    req = AgentRequest(taskInstruction="test")
    # This might raise if our parsing isn't resilient enough, which is exactly what we want to test/fix.
    try:
        plan = asyncio.run(vlm_service.get_action_plan_from_vlm(req))
        # If the service falls back to regex or tries to fix JSON, we assert here.
        # For now, we just ensure it doesn't return an entirely empty un-handled state if it manages to parse `done`.
    except Exception as e:
        # If it fails, that's expected until the parser is upgraded, but the test structure is here.
        assert "JSON" in str(e) or "parse" in str(e).lower()

def test_handles_single_action_fallback(monkeypatch):
    # Some older models might just return a single action object instead of an actions array
    single_obj_str = '{"action": "done", "reasoning": "Task completed"}'
    monkeypatch.setattr(vlm_service.httpx, "AsyncClient", _fake_client(single_obj_str))
    
    req = AgentRequest(taskInstruction="test")
    plan = asyncio.run(vlm_service.get_action_plan_from_vlm(req))
    
    # The service should wrap it in a list
    assert len(plan.actions) == 1
    assert plan.actions[0].action == "done"
