import os
import json
import glob

base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
smoke_dir = os.path.join(base_dir, 'data', 'smoke')
out_path = os.path.join(base_dir, 'data', 'hardened_smoke.jsonl')

files = glob.glob(os.path.join(smoke_dir, '*.json'))
with open(out_path, 'w', encoding='utf-8') as outfile:
    for file in files:
        with open(file, 'r', encoding='utf-8') as infile:
            try:
                data = json.load(infile)
                outfile.write(json.dumps(data) + '\n')
            except Exception as e:
                print(f"Error reading {file}: {e}")

print(f"Combined {len(files)} JSON files into {out_path}")
