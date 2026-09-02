import os
from onnxruntime.quantization import quantize_dynamic, QuantType

def quantize():
    model_input = "extension/public/models/ner/onnx/model.onnx"
    model_output = "extension/public/models/ner-int8/onnx/model_quantized.onnx"
    
    # Ensure the directory exists
    os.makedirs(os.path.dirname(model_output), exist_ok=True)
    
    print(f"Quantizing {model_input} to INT8...")
    
    quantize_dynamic(
        model_input=model_input,
        model_output=model_output,
        weight_type=QuantType.QUInt8,
        # Optimize model requires extra dependencies sometimes, let's keep it safe
        # but dynamic quantization is straight forward for BERT.
    )
    
    # Compare sizes
    original_size = os.path.getsize(model_input) / (1024 * 1024)
    new_size = os.path.getsize(model_output) / (1024 * 1024)
    print(f"Original Size: {original_size:.2f} MB")
    print(f"Quantized Size: {new_size:.2f} MB")
    print(f"Successfully saved quantized model to {model_output}")

if __name__ == "__main__":
    quantize()
