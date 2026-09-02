# RUN THIS SCRIPT IN A GOOGLE COLAB NOTEBOOK (T4 GPU recommended)

# !pip install transformers datasets evaluate seqeval onnx optimum[onnxruntime]

import torch
from datasets import load_dataset
from transformers import (
    AutoTokenizer,
    AutoModelForTokenClassification,
    TrainingArguments,
    Trainer,
    DataCollatorForTokenClassification
)
import evaluate
import numpy as np

# 1. Load dataset (CoNLL-2003 for NER - parquet version compatible with datasets>=3.0)
raw_datasets = load_dataset("lhoestq/conll2003")

# 2. Setup Tiny BERT Config
# Using Prajjwal's tiny BERT as a base (2 layers, 128 hidden) for ~5MB size
model_checkpoint = "prajjwal1/bert-small"
tokenizer = AutoTokenizer.from_pretrained(model_checkpoint)

# Standard CoNLL-2003 9-class tags
label_list = ["O", "B-PER", "I-PER", "B-ORG", "I-ORG", "B-LOC", "I-LOC", "B-MISC", "I-MISC"]
id2label = {i: label for i, label in enumerate(label_list)}
label2id = {v: k for k, v in id2label.items()}

# 3. Tokenize and Align Labels
def tokenize_and_align_labels(examples):
    tokenized_inputs = tokenizer(examples["tokens"], truncation=True, max_length=128, is_split_into_words=True)
    labels = []
    for i, label in enumerate(examples["ner_tags"]):
        word_ids = tokenized_inputs.word_ids(batch_index=i)
        previous_word_idx = None
        label_ids = []
        for word_idx in word_ids:
            if word_idx is None:
                label_ids.append(-100)
            elif word_idx != previous_word_idx:
                label_ids.append(label[word_idx])
            else:
                label_ids.append(-100)
            previous_word_idx = word_idx
        labels.append(label_ids)
    tokenized_inputs["labels"] = labels
    return tokenized_inputs

tokenized_datasets = raw_datasets.map(tokenize_and_align_labels, batched=True)

# 4. Define Model & Training
model = AutoModelForTokenClassification.from_pretrained(
    model_checkpoint,
    num_labels=len(label_list),
    id2label=id2label,
    label2id=label2id
)

args = TrainingArguments(
    "ner-tiny",
    eval_strategy="epoch",
    learning_rate=2e-5,
    per_device_train_batch_size=16,
    per_device_eval_batch_size=16,
    num_train_epochs=5,
    weight_decay=0.01,
    report_to="none",
)

data_collator = DataCollatorForTokenClassification(tokenizer)
metric = evaluate.load("seqeval")

def compute_metrics(p):
    predictions, labels = p
    predictions = np.argmax(predictions, axis=2)
    true_predictions = [
        [label_list[p] for (p, l) in zip(prediction, label) if l != -100]
        for prediction, label in zip(predictions, labels)
    ]
    true_labels = [
        [label_list[l] for (p, l) in zip(prediction, label) if l != -100]
        for prediction, label in zip(predictions, labels)
    ]
    results = metric.compute(predictions=true_predictions, references=true_labels)
    return {
        "precision": results["overall_precision"],
        "recall": results["overall_recall"],
        "f1": results["overall_f1"],
        "accuracy": results["overall_accuracy"],
    }

trainer = Trainer(
    model,
    args,
    train_dataset=tokenized_datasets["train"],
    eval_dataset=tokenized_datasets["validation"],
    data_collator=data_collator,
    tokenizer=tokenizer,
    compute_metrics=compute_metrics
)

print("Training Tiny NER...")
trainer.train()

# 5. Export to ONNX and Quantize
import os
import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer
from onnxruntime.quantization import quantize_dynamic, QuantType

os.makedirs("./ner-tiny-final", exist_ok=True)
os.makedirs("./ner-int8/onnx", exist_ok=True)

model.save_pretrained("./ner-tiny-final")
tokenizer.save_pretrained("./ner-tiny-final")

print("Exporting to ONNX INT8...")
# Native PyTorch ONNX export (bypasses optimum/diffusers version conflicts)
model_to_export = AutoModelForTokenClassification.from_pretrained("./ner-tiny-final")
tokenizer_to_export = AutoTokenizer.from_pretrained("./ner-tiny-final")
model_to_export.eval()

dummy_inputs = tokenizer_to_export("ShieldBrowse visual privacy agent", return_tensors="pt")

torch.onnx.export(
    model_to_export,
    (dummy_inputs["input_ids"], dummy_inputs["attention_mask"]),
    "./ner-int8/onnx/model.onnx",
    input_names=["input_ids", "attention_mask"],
    output_names=["logits"],
    dynamic_axes={
        "input_ids": {0: "batch_size", 1: "sequence_length"},
        "attention_mask": {0: "batch_size", 1: "sequence_length"},
        "logits": {0: "batch_size", 1: "sequence_length"},
    },
    opset_version=14,
    dynamo=False,
)

# Quantize to INT8
inp = "./ner-int8/onnx/model.onnx"
out = "./ner-int8/onnx/model_quantized.onnx"
quantize_dynamic(inp, out, weight_type=QuantType.QUInt8)

print("Final Quantized Size:", round(os.path.getsize(out) / (1024 * 1024), 2), "MB")

print("Done! Copy the contents of ./ner-tiny-final to extension/public/models/ner-int8/")
print("And copy model_quantized.onnx to extension/public/models/ner-int8/onnx/")
