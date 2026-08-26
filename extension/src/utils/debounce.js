// src/utils/debounce.js
// Utility to debounce rapid consecutive function calls (e.g. form input typing)

export function debounce(fn, delay = 100) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}
