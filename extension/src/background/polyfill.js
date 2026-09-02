// src/background/polyfill.js
// Provides a minimal window stub for WASM loaders running in a Service Worker
if (typeof window === 'undefined') {
  self.window = self;
  self.document = {
    createElement: () => ({
      getContext: () => null
    })
  };
}
