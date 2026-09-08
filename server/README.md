# BrowseShield Server (VLM Backend)

This is the FastAPI backend for the BrowseShield extension. It acts as the bridge between the browser extension and the local Vision-Language Model (Ollama/Qwen2.5-VL).

## Prerequisites
- Python 3.10+
- [Ollama](https://ollama.com) installed and running locally.
- `qwen2.5-vl:3b` model pulled in Ollama (`ollama run qwen2.5-vl:3b`).

## Setup
1. Create a virtual environment: `python -m venv venv`
2. Activate it: `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (Mac/Linux)
3. Install dependencies: `pip install -r requirements.txt`

## Running
```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Testing
Run the test suite to verify the VLM endpoint and prompt building:
```bash
pytest tests/
```

## Architecture
The server exposes `POST /agent/action` which:
1. Receives a sanitized DOM payload and a pixel-redacted screenshot.
2. Builds a strict, prompt-injection-resistant context prompt.
3. Forwards the text + image to the local Ollama instance.
4. Parses the JSON output and returns a structured action (e.g. `type`, `click`) to the client.

*Privacy Guarantee: The server never receives raw PII. All PII is tokenized by the client.*
