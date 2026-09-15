#!/usr/bin/env python3
import os
import sys
import glob
import json
import time
import numpy as np
from PIL import Image
import onnxruntime as ort

FP32_PATH = "e:/SIH26/extension/public/models/yolov8n.onnx"
INT8_PATH = "e:/SIH26/extension/public/models/yolov8n_quantized.onnx"
GT_DIR = "e:/SIH26/benchmark/accuracy/ground_truth"
IMG_DIR = "e:/SIH26/benchmark/accuracy/screenshots"

T, CONF, IOU = 640, 0.25, 0.45

UI_CLASSES = [
    "DOB","address","age input","age","button","checkbox","city","company",
    "country dropdown","country input","date","day dropdown","doc-upload","dropdown",
    "email-input","emp id","first-name","gender dropdown","gender","input","job role",
    "last-name","message","month dropdown","name","otp","password","phone-num",
    "redio button","region","reminder checkbox","state dropdown","state input-","state",
    "terms checkbox","username","web url-","year dropdown","zip code"
]

def letterbox(im):
    w, h = im.size
    s = min(T / w, T / h)
    nw, nh = round(w * s), round(h * s)
    ox, oy = (T - nw) // 2, (T - nh) // 2
    canvas = Image.new("RGB", (T, T), (114, 114, 114))
    canvas.paste(im.resize((nw, nh), Image.BILINEAR), (ox, oy))
    ten = np.transpose(np.asarray(canvas, np.float32) / 255.0, (2, 0, 1))[None, ...]
    return ten, s, ox, oy

def compute_iou(boxA, boxB):
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[0] + boxA[2], boxB[0] + boxB[2])
    yB = min(boxA[1] + boxA[3], boxB[1] + boxB[3])
    inter = max(0, xB - xA) * max(0, yB - yA)
    ua = boxA[2] * boxA[3] + boxB[2] * boxB[3] - inter
    return inter / float(ua) if ua > 0 else 0

def nms(d):
    d = sorted(d, key=lambda x: x["conf"], reverse=True)
    keep = []
    while d:
        c = d.pop(0)
        keep.append(c)
        d = [x for x in d if x["cls"] != c["cls"] or compute_iou(c["box"], x["box"]) < IOU]
    return keep

def postprocess(p, W, H, s, ox, oy):
    cls = p[4:, :]
    conf = cls.max(0)
    cid = cls.argmax(0)
    dets = []
    for c in np.where(conf > CONF)[0]:
        cx, cy, bw, bh = p[0, c], p[1, c], p[2, c], p[3, c]
        x = max(0., ((cx - bw / 2) - ox) / s)
        y = max(0., ((cy - bh / 2) - oy) / s)
        w = min(W, x + bw / s) - x
        h = min(H, y + bh / s) - y
        if w > 0 and h > 0:
            dets.append({"box": [float(x), float(y), float(w), float(h)], "conf": float(conf[c]), "cls": int(cid[c])})
    return nms(dets)

def benchmark_model(model_name, model_path, images, runs_per_img=10):
    size_mb = os.path.getsize(model_path) / (1024 * 1024)
    
    # Measure cold load time
    t0 = time.perf_counter()
    sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    load_time_ms = (time.perf_counter() - t0) * 1000.0
    
    iname = sess.get_inputs()[0].name
    
    # Warmup
    dummy = np.zeros((1, 3, T, T), dtype=np.float32)
    for _ in range(3):
        sess.run(None, {iname: dummy})
        
    latencies = []
    all_detections = {}
    
    for img_name, im in images.items():
        W, H = im.size
        ten, s, ox, oy = letterbox(im)
        
        # Multiple runs for accurate latency
        img_lats = []
        last_pred = None
        for _ in range(runs_per_img):
            t_start = time.perf_counter()
            pred = sess.run(None, {iname: ten})[0][0]
            t_end = time.perf_counter()
            img_lats.append((t_end - t_start) * 1000.0)
            last_pred = pred
            
        latencies.extend(img_lats)
        dets = postprocess(last_pred, W, H, s, ox, oy)
        all_detections[img_name] = dets
        
    return {
        "name": model_name,
        "size_mb": size_mb,
        "load_time_ms": load_time_ms,
        "latencies": latencies,
        "detections": all_detections
    }

def evaluate_accuracy(all_detections, gt_metas):
    metrics_per_class = {cls: {'tp': 0, 'fp': 0, 'fn': 0} for cls in UI_CLASSES}
    coarse = {'tp': 0, 'fp': 0, 'fn': 0}
    total_confs = []
    
    for meta in gt_metas:
        img_name = meta['image']
        if img_name not in all_detections:
            continue
            
        dets = all_detections[img_name]
        gt_elements = meta['elements']
        
        for d in dets:
            total_confs.append(d['conf'])
            
        # Coarse matching (class-agnostic)
        matched_gt_coarse = set()
        coarse_tp = 0
        for p in dets:
            best_iou = 0
            best_idx = -1
            for idx, g in enumerate(gt_elements):
                if idx in matched_gt_coarse:
                    continue
                iou_val = compute_iou(p['box'], g['box'])
                if iou_val > best_iou:
                    best_iou = iou_val
                    best_idx = idx
            if best_iou >= 0.5:
                matched_gt_coarse.add(best_idx)
                coarse_tp += 1
                
        coarse['tp'] += coarse_tp
        coarse['fp'] += len(dets) - coarse_tp
        coarse['fn'] += len(gt_elements) - coarse_tp
        
        # Per-class matching
        gt_by_class = {}
        for el in gt_elements:
            cls = el['cls']
            if cls in UI_CLASSES:
                gt_by_class.setdefault(cls, []).append(el['box'])
                
        pred_by_class = {}
        for d in dets:
            cls_name = UI_CLASSES[d['cls']]
            pred_by_class.setdefault(cls_name, []).append(d)
            
        for cls_name in UI_CLASSES:
            gts = gt_by_class.get(cls_name, [])
            preds = sorted(pred_by_class.get(cls_name, []), key=lambda x: x['conf'], reverse=True)
            
            metrics_per_class[cls_name]['fn'] += len(gts)
            metrics_per_class[cls_name]['fp'] += len(preds)
            
            matched = set()
            for p in preds:
                best_iou = 0
                best_idx = -1
                for idx, g in enumerate(gts):
                    if idx in matched:
                        continue
                    iou_val = compute_iou(p['box'], g)
                    if iou_val > best_iou:
                        best_iou = iou_val
                        best_idx = idx
                if best_iou >= 0.5:
                    matched.add(best_idx)
                    metrics_per_class[cls_name]['tp'] += 1
                    metrics_per_class[cls_name]['fp'] -= 1
                    metrics_per_class[cls_name]['fn'] -= 1
                    
    # Aggregate
    c_p = coarse['tp'] / (coarse['tp'] + coarse['fp']) if (coarse['tp'] + coarse['fp']) > 0 else 0
    c_r = coarse['tp'] / (coarse['tp'] + coarse['fn']) if (coarse['tp'] + coarse['fn']) > 0 else 0
    c_f1 = 2 * (c_p * c_r) / (c_p + c_r) if (c_p + c_r) > 0 else 0
    
    class_f1s = []
    class_ps = []
    class_rs = []
    for cls, m in metrics_per_class.items():
        if m['tp'] + m['fp'] + m['fn'] == 0:
            continue
        p = m['tp'] / (m['tp'] + m['fp']) if (m['tp'] + m['fp']) > 0 else 0
        r = m['tp'] / (m['tp'] + m['fn']) if (m['tp'] + m['fn']) > 0 else 0
        f1 = 2 * (p * r) / (p + r) if (p + r) > 0 else 0
        class_ps.append(p)
        class_rs.append(r)
        class_f1s.append(f1)
        
    macro_p = float(np.mean(class_ps)) if class_ps else 0.0
    macro_r = float(np.mean(class_rs)) if class_rs else 0.0
    macro_f1 = float(np.mean(class_f1s)) if class_f1s else 0.0
    
    total_dets = sum(len(v) for v in all_detections.values())
    avg_conf = float(np.mean(total_confs)) if total_confs else 0.0
    
    return {
        "total_detections": total_dets,
        "avg_confidence": avg_conf,
        "coarse_precision": c_p,
        "coarse_recall": c_r,
        "coarse_f1": c_f1,
        "coarse_tp": coarse['tp'],
        "coarse_fp": coarse['fp'],
        "coarse_fn": coarse['fn'],
        "macro_precision": macro_p,
        "macro_recall": macro_r,
        "macro_f1": macro_f1
    }

def main():
    gt_files = glob.glob(os.path.join(GT_DIR, '*_meta.json'))
    gt_metas = []
    images = {}
    for gtf in gt_files:
        with open(gtf, 'r') as f:
            meta = json.load(f)
            gt_metas.append(meta)
            img_path = os.path.join(IMG_DIR, meta['image'])
            if os.path.exists(img_path) and meta['image'] not in images:
                images[meta['image']] = Image.open(img_path).convert("RGB")
                
    print(f"Loaded {len(images)} unique test screenshots with {len(gt_metas)} GT annotations.")
    
    print("\n--- Running FP32 Benchmark ---")
    fp32_res = benchmark_model("FP32 (Full Model)", FP32_PATH, images, runs_per_img=10)
    fp32_acc = evaluate_accuracy(fp32_res["detections"], gt_metas)
    
    print("\n--- Running INT8 (Quantized) Benchmark ---")
    int8_res = benchmark_model("INT8 (Quantized Dynamic)", INT8_PATH, images, runs_per_img=10)
    int8_acc = evaluate_accuracy(int8_res["detections"], gt_metas)
    
    # Calculate box overlap agreement between models
    overlaps = []
    for img_name in images:
        f_dets = fp32_res["detections"].get(img_name, [])
        i_dets = int8_res["detections"].get(img_name, [])
        for f in f_dets:
            max_iou = 0
            for i in i_dets:
                if f['cls'] == i['cls']:
                    iou_val = compute_iou(f['box'], i['box'])
                    if iou_val > max_iou:
                        max_iou = iou_val
            overlaps.append(max_iou)
    agreement_iou = float(np.mean(overlaps)) if overlaps else 0.0
    
    summary = {
        "fp32": {
            "size_mb": fp32_res["size_mb"],
            "load_time_ms": fp32_res["load_time_ms"],
            "lat_mean_ms": float(np.mean(fp32_res["latencies"])),
            "lat_median_ms": float(np.median(fp32_res["latencies"])),
            "lat_p95_ms": float(np.percentile(fp32_res["latencies"], 95)),
            "lat_min_ms": float(np.min(fp32_res["latencies"])),
            "lat_max_ms": float(np.max(fp32_res["latencies"])),
            "accuracy": fp32_acc
        },
        "int8": {
            "size_mb": int8_res["size_mb"],
            "load_time_ms": int8_res["load_time_ms"],
            "lat_mean_ms": float(np.mean(int8_res["latencies"])),
            "lat_median_ms": float(np.median(int8_res["latencies"])),
            "lat_p95_ms": float(np.percentile(int8_res["latencies"], 95)),
            "lat_min_ms": float(np.min(int8_res["latencies"])),
            "lat_max_ms": float(np.max(int8_res["latencies"])),
            "accuracy": int8_acc
        },
        "comparison": {
            "size_reduction_pct": (1.0 - int8_res["size_mb"] / fp32_res["size_mb"]) * 100,
            "speedup_ratio": float(np.mean(fp32_res["latencies"])) / float(np.mean(int8_res["latencies"])),
            "latency_reduction_pct": (1.0 - float(np.mean(int8_res["latencies"])) / float(np.mean(fp32_res["latencies"]))) * 100,
            "prediction_agreement_iou": agreement_iou
        }
    }
    
    print("\n================== BENCHMARK RESULTS (RAW JSON) ==================")
    print(json.dumps(summary, indent=2))
    
    out_path = "e:/SIH26/benchmark/scripts/benchmark_model_comparison.json"
    with open(out_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nSaved results to {out_path}")

if __name__ == "__main__":
    main()
