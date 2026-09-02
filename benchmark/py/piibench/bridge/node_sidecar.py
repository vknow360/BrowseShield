import subprocess
import json
import os

class NodeDetectorBridge:
    def __init__(self):
        script_path = os.path.join(os.path.dirname(__file__), '../../../js/run_detector.js')
        self.process = subprocess.Popen(
            ['node', script_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

    def predict(self, req_id, text=None, nodes=None):
        payload = {"id": req_id}
        if text is not None:
            payload["text"] = text
        if nodes is not None:
            payload["nodes"] = nodes
            
        self.process.stdin.write(json.dumps(payload) + "\n")
        self.process.stdin.flush()
        
        line = self.process.stdout.readline()
        if not line:
            err = self.process.stderr.read()
            raise RuntimeError(f"Node sidecar crashed: {err}")
        
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            raise RuntimeError(f"Failed to parse JSON from Node. Raw output: {line!r}")

    def close(self):
        self.process.stdin.close()
        self.process.wait()

def run_smoke_test():
    print("Starting Node sidecar bridge...")
    bridge = NodeDetectorBridge()
    
    print("Testing plain text...")
    res = bridge.predict("test1", text="My Aadhaar number is 1234 5678 9012")
    print(res)
    
    print("Testing DOM nodes...")
    nodes = [{"id": "n1", "value": "test@example.com", "type": "email"}]
    res2 = bridge.predict("test2", nodes=nodes)
    print(res2)
    
    bridge.close()
    print("Smoke test successful!")
