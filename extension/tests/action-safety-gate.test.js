import { describe, it, expect } from 'vitest';
import { validateAction } from '../src/core/action-safety-gate.js';

describe('Action Safety Gate', () => {
  it('allows valid type actions', () => {
    const action = { action: 'type', target: '#name', value: 'John' };
    const result = validateAction(action, null); // document mock null
    expect(result.valid).toBe(true);
  });

  it('allows valid click actions', () => {
    const action = { action: 'click', target: '.submit-btn' };
    const result = validateAction(action, null);
    expect(result.valid).toBe(true);
  });

  it('blocks unknown action types', () => {
    const action = { action: 'delete', target: '#name' };
    const result = validateAction(action, null);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unknown action type');
  });

  it('blocks dangerous eval injections', () => {
    const action = { action: 'type', target: '#name', value: 'eval(alert(1))' };
    const result = validateAction(action, null);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Dangerous pattern');
  });

  it('blocks javascript: URIs', () => {
    const action = { action: 'navigate', target: 'window', value: 'javascript:alert(1)' };
    const result = validateAction(action, null);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Dangerous pattern');
  });

  it('blocks script tags in reasoning', () => {
    const action = { action: 'click', target: '#btn', reasoning: '<script>fetch()</script>' };
    const result = validateAction(action, null);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Dangerous pattern');
  });

  it('requires a value for type actions', () => {
    const action = { action: 'type', target: '#name' };
    const result = validateAction(action, null);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('requires a value');
  });

  it('allows done actions without a target', () => {
    const action = { action: 'done' };
    const result = validateAction(action, null);
    expect(result.valid).toBe(true);
  });
});
