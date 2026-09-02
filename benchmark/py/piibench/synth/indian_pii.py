import random
import json
import os
from faker import Faker

fake = Faker('en_IN')

# Aadhaar Verhoeff Checksum
d = [
    [0,1,2,3,4,5,6,7,8,9], [1,2,3,4,0,6,7,8,9,5], [2,3,4,0,1,7,8,9,5,6],
    [3,4,0,1,2,8,9,5,6,7], [4,0,1,2,3,9,5,6,7,8], [5,9,8,7,6,0,4,3,2,1],
    [6,5,9,8,7,1,0,4,3,2], [7,6,5,9,8,2,1,0,4,3], [8,7,6,5,9,3,2,1,0,4],
    [9,8,7,6,5,4,3,2,1,0]
]
p = [
    [0,1,2,3,4,5,6,7,8,9], [1,5,7,6,2,8,3,0,9,4], [5,8,0,3,7,9,6,1,4,2],
    [8,9,1,6,0,4,3,5,2,7], [9,4,5,3,1,2,6,8,7,0], [4,2,8,6,5,7,3,9,0,1],
    [2,7,9,3,8,0,6,4,1,5], [7,0,4,6,9,1,3,2,5,8]
]

def generate_aadhaar():
    num = [random.randint(0, 9) for _ in range(11)]
    c = 0
    for i, n in enumerate(reversed(num)):
        c = d[c][p[(i + 1) % 8][n]]
    inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]
    num.append(inv[c])
    return "".join(map(str, num))

def generate_pan():
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    status = "CPHFATBLJG"
    return "".join(random.choices(letters, k=3)) + random.choice(status) + random.choice(letters) + "".join(str(random.randint(0,9)) for _ in range(4)) + random.choice(letters)

def generate_ifsc():
    banks = ["SBIN", "HDFC", "ICIC", "PUNB", "UTIB"]
    return random.choice(banks) + "0" + "".join(random.choices("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", k=6))

def generate_dataset(num_samples=100):
    samples = []
    for i in range(num_samples):
        # We generate JSON DOM format
        node_type = random.choice(["AADHAAR", "PAN", "IFSC", "PERSON", "PHONE"])
        if node_type == "AADHAAR":
            val = generate_aadhaar()
            label = random.choice(["Aadhaar", "UIDAI", "Aadhar No"])
        elif node_type == "PAN":
            val = generate_pan()
            label = "PAN Number"
        elif node_type == "IFSC":
            val = generate_ifsc()
            label = "IFSC Code"
        elif node_type == "PERSON":
            val = fake.name()
            label = "Full Name"
        elif node_type == "PHONE":
            val = fake.phone_number()
            label = "Mobile"

        samples.append({
            "nodes": [{
                "id": f"input_{i}",
                "value": val,
                "label": label,
                "tagName": "INPUT",
                "type": "text"
            }],
            "groundTruth": [{
                "id": f"input_{i}",
                "entityType": node_type,
                "value": val
            }]
        })
    return samples

def write_synth_dataset(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    samples = generate_dataset(500)
    out_path = os.path.join(out_dir, "indian_synth.jsonl")
    with open(out_path, "w", encoding="utf-8") as f:
        for s in samples:
            f.write(json.dumps(s) + "\n")
    print(f"Generated synthetic Indian PII dataset at {out_path}")

if __name__ == "__main__":
    write_synth_dataset("benchmark/data")
