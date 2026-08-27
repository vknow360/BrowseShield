// action-executor.js — runs in content script

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function executeAction(action, tokenizer) {
  const { action: actionType, target, value, reasoning } = action;
  
  console.log(`[ShieldBrowse] Executing: ${actionType} on ${target} (${reasoning})`);
  
  switch (actionType) {
    case 'type': {
      const element = document.querySelector(target);
      if (!element) throw new Error(`Element not found: ${target}`);
      
      // REHYDRATE: Replace tokens with real values
      const realValue = tokenizer.rehydrateString(value);
      
      // Focus the element
      element.focus();
      
      // Clear existing value (some frameworks need native setters bypassed)
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(element, realValue);
      } else {
        element.value = realValue;
      }
      
      // Dispatch events so the page's JavaScript reacts
      // (React, Angular, Vue all listen for these events)
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      
      return { success: true, action: actionType, target };
    }
    
    case 'click': {
      if (typeof target === 'object' && target !== null && 'x' in target && 'y' in target) {
        console.log(`[ShieldBrowse] Vision-grounded physical coordinate click at (${target.x}, ${target.y})`);
        
        // Translate from VLM's f-scaled physical pixels back to the browser's logical CSS pixels
        const f = action.f || 1;
        const dpr = window.devicePixelRatio || 1;
        const logicalX = target.x / (f * dpr);
        const logicalY = target.y / (f * dpr);
        
        console.log(`[ShieldBrowse] Translated to logical viewport CSS coordinates: (${logicalX}, ${logicalY})`);

        const el = document.elementFromPoint(logicalX, logicalY) || document.body;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        el.click();
        return { success: true, action: actionType, target };
      }

      const element = document.querySelector(target);
      if (!element) throw new Error(`Element not found: ${target}`);
      
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300); // Wait for scroll
      
      element.click();
      
      return { success: true, action: actionType, target };
    }
    
    case 'scroll': {
      const amount = value === 'down' ? 500 : -500;
      window.scrollBy({ top: amount, behavior: 'smooth' });
      
      return { success: true, action: actionType, direction: value };
    }
    
    case 'select': {
      const element = document.querySelector(target);
      if (!element) throw new Error(`Element not found: ${target}`);
      
      // Find the option matching the value text
      const realValue = tokenizer.rehydrateString(value);
      const options = Array.from(element.options);
      const matchingOption = options.find(opt => 
        opt.text.toLowerCase().includes(realValue.toLowerCase()) ||
        opt.value.toLowerCase().includes(realValue.toLowerCase())
      );
      
      if (matchingOption) {
        element.value = matchingOption.value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      return { success: true, action: actionType, target };
    }
    
    case 'navigate': {
      // Rehydrate in case the URL contains a token (rare, but possible)
      const realValue = tokenizer.rehydrateString(value);
      window.location.href = realValue;
      return { success: true, action: actionType };
    }

    case 'wait': {
      await sleep(parseInt(value) || 1000);
      return { success: true, action: actionType };
    }
    
    case 'done': {
      return { success: true, action: 'done', reasoning };
    }
    
    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}
