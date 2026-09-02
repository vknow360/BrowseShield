def calculate_iou(boxA, boxB):
    # box is [x_min, y_min, x_max, y_max]
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    interArea = max(0, xB - xA) * max(0, yB - yA)
    if interArea == 0:
        return 0.0

    boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])

    iou = interArea / float(boxAArea + boxBArea - interArea)
    return iou

def score_boxes(ground_truth, predictions, iou_threshold=0.5):
    """
    COCO-style AP/F1 at fixed IoU.
    ground_truth: list of dicts with 'box' and 'label'
    predictions: list of dicts with 'box' and 'label'
    """
    tp = 0
    fp = 0
    fn = len(ground_truth)
    
    matched_gt = set()
    
    for pred in predictions:
        best_iou = 0
        best_gt_idx = -1
        
        for i, gt in enumerate(ground_truth):
            if i in matched_gt or pred['label'] != gt['label']:
                continue
                
            iou = calculate_iou(pred['box'], gt['box'])
            if iou > best_iou:
                best_iou = iou
                best_gt_idx = i
                
        if best_iou >= iou_threshold:
            tp += 1
            matched_gt.add(best_gt_idx)
            fn -= 1
        else:
            fp += 1
            
    p = tp / (tp + fp) if tp + fp > 0 else 0.0
    r = tp / (tp + fn) if tp + fn > 0 else 0.0
    f1 = 2 * p * r / (p + r) if p + r > 0 else 0.0
    
    return {
        "precision": p,
        "recall": r,
        "f1": f1
    }
