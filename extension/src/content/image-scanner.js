import browser from "webextension-polyfill";

export async function scanImagesAndRedact() {
  const images = Array.from(document.querySelectorAll('img:not([data-redacted="true"])'));
  if (images.length === 0) return;

  console.log(`[ShieldBrowse] Found ${images.length} new image(s). Running face detection...`);

  for (const img of images) {
    if (img.width === 0 || img.height === 0) continue; // Skip invisible images

    try {
      // Convert img to Data URI using an offscreen canvas
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, img.width, img.height);
      const dataUri = canvas.toDataURL('image/jpeg');

      // Send to Background SW for inference
      const response = await browser.runtime.sendMessage({
        type: 'DETECT_FACES',
        payload: { dataUri, width: img.width, height: img.height }
      });

      if (response && response.status === 'success' && response.faces && response.faces.length > 0) {
        applyRedactionBoxes(img, response.faces);
      }
      
      // Mark as processed
      img.setAttribute('data-redacted', 'true');
    } catch (e) {
      console.warn('[ShieldBrowse] Failed to scan image for faces:', e);
    }
  }
}

function applyRedactionBoxes(img, faces) {
  const rect = img.getBoundingClientRect();
  
  faces.forEach((face) => {
    const box = face.boundingBox;
    
    // Create redaction div
    const redactionBox = document.createElement('div');
    redactionBox.className = 'shieldbrowse-face-redaction';
    redactionBox.style.position = 'absolute';
    redactionBox.style.backgroundColor = 'black';
    redactionBox.style.zIndex = '999999';
    redactionBox.style.borderRadius = '4px';
    
    // Calculate absolute position on the page based on the image's layout box
    // Note: MediaPipe bounding box is relative to the image size sent (which was img.width)
    redactionBox.style.left = `${rect.left + window.scrollX + box.originX}px`;
    redactionBox.style.top = `${rect.top + window.scrollY + box.originY}px`;
    redactionBox.style.width = `${box.width}px`;
    redactionBox.style.height = `${box.height}px`;
    
    // Add title for debugging
    redactionBox.title = 'Face Redacted by ShieldBrowse Vision Pipeline';
    
    document.body.appendChild(redactionBox);
  });
  
  console.log(`[ShieldBrowse] Redacted ${faces.length} face(s) over image.`);
}
