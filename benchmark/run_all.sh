#!/bin/bash
# run_all.sh
# Unified benchmark harness to reproduce claims

echo "======================================"
echo "    BrowseShield Benchmark Harness    "
echo "======================================"

echo "[1/3] Measuring DOM Detection Latency..."
node benchmark/js/measure_latency.js > reports/latency_report.txt
cat reports/latency_report.txt

echo "\n[2/3] Evaluating YOLO Accuracy (IoU)..."
# Assuming Python environment is setup
python benchmark/accuracy/score_accuracy.py --ground-truth benchmark/accuracy/ground_truth.json > reports/yolo_accuracy_report.txt
cat reports/yolo_accuracy_report.txt

echo "\n[3/3] Evaluating PII Tokenizer Scoring..."
python benchmark/py/piibench/cli.py > reports/pii_score_report.txt
cat reports/pii_score_report.txt

echo "\n======================================"
echo "          Unified Results             "
echo "======================================"
echo "Latency: See reports/latency_report.txt"
echo "Accuracy: See reports/yolo_accuracy_report.txt"
echo "PII F1 Score: See reports/pii_score_report.txt"
echo "Done."
