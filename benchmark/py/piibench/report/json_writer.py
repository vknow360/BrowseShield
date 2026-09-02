import json
import os
from datetime import datetime

def write_json_report(report_data, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    report_data['generated_at'] = datetime.utcnow().isoformat()
    
    path = os.path.join(out_dir, 'metrics_report.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(report_data, f, indent=2)
    print(f"JSON report saved to {path}")
