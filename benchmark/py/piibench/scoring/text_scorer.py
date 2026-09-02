from seqeval.metrics import f1_score, precision_score, recall_score, classification_report
from seqeval.scheme import IOB2

def score_ner(y_true, y_pred):
    """
    y_true: List of list of strings (IOB2 tags)
    y_pred: List of list of strings (IOB2 tags)
    """
    f1 = f1_score(y_true, y_pred, mode='strict', scheme=IOB2)
    p = precision_score(y_true, y_pred, mode='strict', scheme=IOB2)
    r = recall_score(y_true, y_pred, mode='strict', scheme=IOB2)
    
    report = classification_report(y_true, y_pred, mode='strict', scheme=IOB2, output_dict=True)
    
    return {
        "entity_f1_macro": f1,
        "precision_macro": p,
        "recall_macro": r,
        "per_entity": report
    }
