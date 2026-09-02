import os
import json
import glob

smoke_dir = os.path.join('data', 'smoke')
out_path = os.path.join('data', 'hardened_smoke.jsonl')

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
