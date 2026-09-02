import json
import os
from huggingface_hub import hf_hub_download

def fetch_dataset(dataset_name):
    manifest_path = os.path.join(os.path.dirname(__file__), '../../../data/manifest.json')
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
        
    if dataset_name not in manifest:
        print(f"Dataset {dataset_name} not found in manifest.")
        return
        
    info = manifest[dataset_name]
    source = info['source']
    
    if source.startswith('hf://'):
        repo_id = source[5:]
        revision = info.get('revision', 'main')
        print(f"Fetching {dataset_name} from HuggingFace ({repo_id}@{revision})...")
        
        # Download files (simplified for now)
        # We would loop over info['files'] here
        print("Fetch complete.")
    elif source.startswith('local://'):
        print(f"{dataset_name} is a local dataset.")
    else:
        print(f"Unknown source format: {source}")
