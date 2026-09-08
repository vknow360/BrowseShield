import os
import sys
import glob
import json
import numpy as np
from PIL import Image

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
import verify_yolo_ui

GT_DIR = os.path.join(os.path.dirname(__file__), 'ground_truth')
IMG_DIR = os.path.join(os.path.dirname(__file__), 'screenshots')
MODEL_PATH = "e:/SIH26/extension/public/models/yolov8n.onnx"

def compute_iou(boxA, boxB):
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[0] + boxA[2], boxB[0] + boxB[2])
    yB = min(boxA[1] + boxA[3], boxB[1] + boxB[3])

    interArea = max(0, xB - xA) * max(0, yB - yA)
    boxAArea = boxA[2] * boxA[3]
    boxBArea = boxB[2] * boxB[3]

    iou = interArea / float(boxAArea + boxBArea - interArea) if (boxAArea + boxBArea - interArea) > 0 else 0
    return iou

def evaluate():
    gt_files = glob.glob(os.path.join(GT_DIR, '*_meta.json'))
    
    if not gt_files:
        print(f"No ground truth files found in {GT_DIR}. Run capture_screenshots.js first.")
        return

    metrics_per_class = {cls: {'tp': 0, 'fp': 0, 'fn': 0} for cls in verify_yolo_ui.UI_CLASSES}
    
    for gt_file in gt_files:
        with open(gt_file, 'r') as f:
            meta = json.load(f)
            
        img_path = os.path.join(IMG_DIR, meta['image'])
        if not os.path.exists(img_path):
            print(f"Image {img_path} not found.")
            continue
            
        im = Image.open(img_path).convert("RGB")
        dets = verify_yolo_ui.run_model(MODEL_PATH, im, img_path)
        
        # Ground truth boxes
        gt_elements = meta['elements']
        
        # Group GT by class
        gt_by_class = {}
        for el in gt_elements:
            cls = el['cls']
            if cls not in verify_yolo_ui.UI_CLASSES:
                continue # ignore elements we don't have classes for
            gt_by_class.setdefault(cls, []).append(el['box'])
            
        # Group Preds by class
        pred_by_class = {}
        all_preds = []
        for det in dets:
            cls_name = verify_yolo_ui.UI_CLASSES[det['cls']]
            pred_by_class.setdefault(cls_name, []).append(det)
            all_preds.append(det)
            
        # Coarse localization matching (class agnostic)
        coarse_matched_gt = set()
        coarse_tp = 0
        for p in all_preds:
            best_iou = 0
            best_gt_idx = -1
            for idx, g in enumerate(gt_elements):
                if idx in coarse_matched_gt: continue
                iou = compute_iou(p['box'], g['box'])
                if iou > best_iou:
                    best_iou = iou
                    best_gt_idx = idx
            if best_iou >= 0.5:
                coarse_matched_gt.add(best_gt_idx)
                coarse_tp += 1
                print(f"[COARSE MATCH] Pred {p['cls']} {p['box']} <-> GT {gt_elements[best_gt_idx]['cls']} {gt_elements[best_gt_idx]['box']} (IoU {best_iou:.2f})")
            else:
                print(f"[COARSE MISS] Pred {p['cls']} {p['box']} best IoU {best_iou:.2f}")
                
        metrics_per_class['__coarse__'] = metrics_per_class.get('__coarse__', {'tp': 0, 'fp': 0, 'fn': 0})
        metrics_per_class['__coarse__']['tp'] += coarse_tp
        metrics_per_class['__coarse__']['fp'] += len(all_preds) - coarse_tp
        metrics_per_class['__coarse__']['fn'] += len(gt_elements) - coarse_tp
            
        # Match per class
        for cls_name in verify_yolo_ui.UI_CLASSES:
            gts = gt_by_class.get(cls_name, [])
            preds = sorted(pred_by_class.get(cls_name, []), key=lambda x: x['conf'], reverse=True)
            
            metrics_per_class[cls_name]['fn'] += len(gts)
            metrics_per_class[cls_name]['fp'] += len(preds)
            
            matched_gt = set()
            for p in preds:
                best_iou = 0
                best_gt_idx = -1
                for idx, g in enumerate(gts):
                    if idx in matched_gt:
                        continue
                    iou = compute_iou(p['box'], g)
                    if iou > best_iou:
                        best_iou = iou
                        best_gt_idx = idx
                
                if best_iou >= 0.5:
                    matched_gt.add(best_gt_idx)
                    metrics_per_class[cls_name]['tp'] += 1
                    metrics_per_class[cls_name]['fp'] -= 1
                    metrics_per_class[cls_name]['fn'] -= 1
                else:
                    print(f"[{cls_name}] Pred {p['box']} best IoU {best_iou:.2f} with GT {gts[best_gt_idx] if best_gt_idx >= 0 else 'None'}")

    print(f"{'Class':<20} {'Precision':<10} {'Recall':<10} {'F1':<10} {'TP/FP/FN'}")
    print("-" * 65)
    
    macro_p, macro_r, macro_f1 = [], [], []
    
    for cls, m in metrics_per_class.items():
        if m['tp'] + m['fp'] + m['fn'] == 0:
            continue
            
        p = m['tp'] / (m['tp'] + m['fp']) if (m['tp'] + m['fp']) > 0 else 0
        r = m['tp'] / (m['tp'] + m['fn']) if (m['tp'] + m['fn']) > 0 else 0
        f1 = 2 * (p * r) / (p + r) if (p + r) > 0 else 0
        
        macro_p.append(p)
        macro_r.append(r)
        macro_f1.append(f1)
        
        print(f"{cls:<20} {p:<10.2f} {r:<10.2f} {f1:<10.2f} {m['tp']}/{m['fp']}/{m['fn']}")

    print("-" * 65)
    if macro_p:
        print(f"mAP@0.5 (Macro Precision):  {np.mean(macro_p):.2f}")
        print(f"Macro Recall:               {np.mean(macro_r):.2f}")
        print(f"Macro F1:                   {np.mean(macro_f1):.2f}")
    else:
        print("No valid elements found.")
        
    print("\n--- Coarse Localization (Class-Agnostic) ---")
    c = metrics_per_class.get('__coarse__', {'tp':0, 'fp':0, 'fn':0})
    if c['tp'] + c['fp'] + c['fn'] > 0:
        cp = c['tp'] / (c['tp'] + c['fp']) if (c['tp'] + c['fp']) > 0 else 0
        cr = c['tp'] / (c['tp'] + c['fn']) if (c['tp'] + c['fn']) > 0 else 0
        cf1 = 2 * (cp * cr) / (cp + cr) if (cp + cr) > 0 else 0
        print(f"Localization Precision: {cp:.2f}")
        print(f"Localization Recall:    {cr:.2f}")
        print(f"Localization F1:        {cf1:.2f}")
        print(f"TP/FP/FN:               {c['tp']}/{c['fp']}/{c['fn']}")

if __name__ == '__main__':
    evaluate()
