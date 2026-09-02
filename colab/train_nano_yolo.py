# RUN THIS SCRIPT IN A GOOGLE COLAB NOTEBOOK (T4 GPU recommended)

# !pip install ultralytics

from ultralytics import YOLO

# 1. Download base model (YOLOv8 nano - 3.2MB)
model = YOLO('yolov8n.pt')

# 2. Train on Web UI Elements dataset
# Note: You'll need to define a data.yaml that points to a WebUI dataset (like RICO or similar)
# Since we can't directly scrape foduucom's proprietary dataset, we assume you've uploaded a data.yaml
# and the dataset zip to Colab. 

# Example data.yaml:
# train: ./dataset/images/train
# val: ./dataset/images/val
# nc: 39
# names: ["DOB", "address", "age input", "age", "button", "checkbox", ...]

print("Training YOLOv8-nano on UI elements...")
model.train(
    data='data.yaml', 
    epochs=100, 
    imgsz=640,
    batch=32,
    device=0
)

# 3. Export the trained model to ONNX
print("Exporting trained model to ONNX...")
model.export(format='onnx', opset=12)

print("Done! Copy the exported best.onnx to extension/public/models/yolov8n.onnx")
