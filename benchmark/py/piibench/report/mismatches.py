import os
import json

def write_mismatches(dataset_name, fp, fn, out_dir):
    mismatch_dir = os.path.join(out_dir, "mismatches")
    os.makedirs(mismatch_dir, exist_ok=True)
    
    path = os.path.join(mismatch_dir, f"{dataset_name}.jsonl")
    with open(path, 'w', encoding='utf-8') as f:
        for item in fp[:20]:
            f.write(json.dumps({"type": "FP", "data": item}) + "\n")
        for item in fn[:20]:
            f.write(json.dumps({"type": "FN", "data": item}) + "\n")
