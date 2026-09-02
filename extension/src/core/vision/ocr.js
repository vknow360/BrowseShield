import { createWorker } from 'tesseract.js';

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      console.log("[OCR] Initializing Tesseract.js Worker...");
      const worker = await createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('tesseract/tesseract-core-simd.wasm.js'),
        // Tesseract appends /eng.traineddata.gz or similar to the langPath.
        // It's expecting the URL to the directory containing eng.traineddata.gz
        langPath: chrome.runtime.getURL('tesseract'),
        gzip: true,
        logger: m => {
          if (m.status === "recognizing text") {
            // Keep logging quiet unless debugging
          }
        }
      });
      console.log("[OCR] Tesseract Worker ready.");
      return worker;
    })();
  }
  return workerPromise;
}

/**
 * Runs OCR on a cropped canvas or image blob and returns bounding boxes of text.
 * @param {ImageBitmap|Blob|HTMLCanvasElement|string} imageBitmapOrCrop 
 * @returns {Promise<Array<{text: string, box: {x0: number, y0: number, x1: number, y1: number}, conf: number}>>}
 */
export async function ocrRegion(imageBitmapOrCrop) {
  try {
    const worker = await getWorker();
    // Tesseract.js v5+ requires an explicit output config to include `blocks`
    // and `words` — the default `recognize()` only returns `text`. Without
    // this, `data.words` is `undefined` and every canvas returns 0 tokens.
    const { data } = await worker.recognize(
      imageBitmapOrCrop,
      {},
      { blocks: true, text: true },
    );

    const results = [];
    // Prefer `words` when present; otherwise walk blocks -> paragraphs ->
    // lines -> words to stay resilient across tesseract.js versions.
    let words = data && data.words ? data.words : [];
    if ((!words || words.length === 0) && data && Array.isArray(data.blocks)) {
      for (const b of data.blocks) {
        for (const p of b.paragraphs || []) {
          for (const l of p.lines || []) {
            for (const w of l.words || []) words.push(w);
          }
        }
      }
    }
    if (data) {
      console.log(`[OCR] recognized ${words.length} raw words (text="${(data.text || '').slice(0, 120).replace(/\n/g, ' | ')}")`);
      
      const validWords = [];
      for (const word of words) {
        if (word.confidence > 30 && word.text && word.text.trim()) {
          validWords.push({
            text: word.text,
            box: { ...word.bbox }, // {x0, y0, x1, y1}
            conf: word.confidence
          });
        }
      }

      // Sort words top-to-bottom, left-to-right
      validWords.sort((a, b) => {
        const aCenterY = (a.box.y0 + a.box.y1) / 2;
        if (aCenterY >= b.box.y0 && aCenterY <= b.box.y1) {
          return a.box.x0 - b.box.x0;
        }
        return a.box.y0 - b.box.y0;
      });

      // Merge adjacent words on the same line
      for (const res of validWords) {
        if (results.length === 0) {
          results.push(res);
          continue;
        }
        const last = results[results.length - 1];
        
        const resCenterY = (res.box.y0 + res.box.y1) / 2;
        const isSameLine = resCenterY >= last.box.y0 && resCenterY <= last.box.y1;
        
        const charWidth = (last.box.x1 - last.box.x0) / Math.max(1, last.text.length);
        const dist = res.box.x0 - last.box.x1;
        
        // Merge if on same line and horizontally adjacent (distance < 3 char widths, allowing slight overlap)
        if (isSameLine && dist >= -charWidth && dist < charWidth * 3) {
          last.text += " " + res.text;
          last.box.x1 = Math.max(last.box.x1, res.box.x1);
          last.box.y0 = Math.min(last.box.y0, res.box.y0);
          last.box.y1 = Math.max(last.box.y1, res.box.y1);
          last.conf = Math.min(last.conf, res.conf); // conservative confidence
        } else {
          results.push(res);
        }
      }
    }
    return results;
  } catch (err) {
    console.error("[OCR] Failed to run OCR on region:", err);
    return [];
  }
}
