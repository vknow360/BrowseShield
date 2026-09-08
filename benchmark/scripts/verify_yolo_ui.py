#!/usr/bin/env python3
import sys, os, glob
import numpy as np
from PIL import Image, ImageDraw
import onnxruntime as ort

MODEL_FP32 = "e:/SIH26/extension/public/models/yolov8n_fp32.onnx"
MODEL_INT8 = "e:/SIH26/extension/public/models/yolov8n.onnx"
IMG_DIR = "e:/SIH26/server/debug_images"
OUT_DIR = "verify_out"
T, CONF, IOU = 640, 0.25, 0.45

UI_CLASSES = ["DOB","address","age input","age","button","checkbox","city","company",
 "country dropdown","country input","date","day dropdown","doc-upload","dropdown",
 "email-input","emp id","first-name","gender dropdown","gender","input","job role",
 "last-name","message","month dropdown","name","otp","password","phone-num",
 "redio button","region","reminder checkbox","state dropdown","state input-","state",
 "terms checkbox","username","web url-","year dropdown","zip code"]

def letterbox(im):
    w,h = im.size; s = min(T/w, T/h)
    nw,nh = round(w*s), round(h*s); ox,oy = (T-nw)//2, (T-nh)//2
    canvas = Image.new("RGB",(T,T),(114,114,114))
    canvas.paste(im.resize((nw,nh), Image.BILINEAR),(ox,oy))
    ten = np.transpose(np.asarray(canvas,np.float32)/255.0,(2,0,1))[None,...]
    return ten, s, ox, oy

def iou(a,b):
    xA,yA=max(a[0],b[0]),max(a[1],b[1])
    xB,yB=min(a[0]+a[2],b[0]+b[2]),min(a[1]+a[3],b[1]+b[3])
    inter=max(0,xB-xA)*max(0,yB-yA); ua=a[2]*a[3]+b[2]*b[3]-inter
    return inter/ua if ua>0 else 0

def nms(d):
    d=sorted(d,key=lambda x:x["conf"],reverse=True); keep=[]
    while d:
        c=d.pop(0); keep.append(c)
        d=[x for x in d if x["cls"]!=c["cls"] or iou(c["box"],x["box"])<IOU]
    return keep

def run_model(model_path, im, f):
    sess=ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    iname=sess.get_inputs()[0].name
    W,H=im.size
    ten,s,ox,oy=letterbox(im); p=sess.run(None,{iname:ten})[0][0]  # (43,8400)
    cls=p[4:,:]; conf=cls.max(0); cid=cls.argmax(0); dets=[]
    for c in np.where(conf>CONF)[0]:
        cx,cy,bw,bh=p[0,c],p[1,c],p[2,c],p[3,c]
        x=max(0.,((cx-bw/2)-ox)/s); y=max(0.,((cy-bh/2)-oy)/s)
        w=min(W,x+bw/s)-x; h=min(H,y+bh/s)-y
        if w>0 and h>0: dets.append({"box":[x,y,w,h],"conf":float(conf[c]),"cls":int(cid[c])})
    dets=nms(dets)
    return dets

def main():
    os.makedirs(OUT_DIR,exist_ok=True)
    files=sum([glob.glob(os.path.join(IMG_DIR,e)) for e in ("*.png","*.jpg","*.jpeg")],[])
    # pick 3 files
    files = files[:3]
    if not files: print("No images in",IMG_DIR); return
    
    for f in files:
        im=Image.open(f).convert("RGB")
        dets_fp32 = run_model(MODEL_FP32, im, f)
        dets_int8 = run_model(MODEL_INT8, im, f)
        
        print(f"\n[Image: {os.path.basename(f)}]")
        print(f"FP32 Model: {len(dets_fp32)} detections")
        print(f"INT8 Model: {len(dets_int8)} detections")
        
        # print top 5 dets for comparison
        print("  Top 5 FP32:")
        for det in sorted(dets_fp32,key=lambda x:-x["conf"])[:5]:
            lbl=f'{UI_CLASSES[det["cls"]]} {det["conf"]:.2f}'
            print(f'   {lbl:28s}')
            
        print("  Top 5 INT8:")
        for det in sorted(dets_int8,key=lambda x:-x["conf"])[:5]:
            lbl=f'{UI_CLASSES[det["cls"]]} {det["conf"]:.2f}'
            print(f'   {lbl:28s}')

if __name__=="__main__": main()
