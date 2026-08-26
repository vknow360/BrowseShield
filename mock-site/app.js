// app.js — Interactive logic for ArogyaShield Claim Portal
import { DEMO_PROFILES } from './demo-profiles.js';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('claimForm');
  const profileSelect = document.getElementById('profileSelect');
  const quickFillBtn = document.getElementById('quickFillBtn');
  const quickClearBtn = document.getElementById('quickClearBtn');
  const resetBtn = document.getElementById('resetBtn');
  const domPreviewBox = document.getElementById('domPreviewBox');

  // Input elements mapping
  const formFields = [
    'policyNumber', 'memberId', 'fullName', 'dob', 'gender',
    'aadhaar', 'pan', 'phone', 'email', 'address', 'city',
    'state', 'pincode', 'emergencyContactName', 'emergencyContactPhone', 'relation'
  ];

  // Helper to load a profile
  function loadProfile(profileId) {
    const profile = DEMO_PROFILES.find(p => p.id === profileId);
    if (!profile) {
      clearForm();
      return;
    }

    formFields.forEach(field => {
      const input = document.getElementById(field);
      if (input && profile[field] !== undefined) {
        input.value = profile[field];
        // Dispatch input event so live listeners trigger
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    updateLiveDomStream();
  }

  // Clear form
  function clearForm() {
    form.reset();
    formFields.forEach(field => {
      const input = document.getElementById(field);
      if (input) input.value = '';
    });
    updateLiveDomStream();
  }

  // Live inspector updater
  function updateLiveDomStream() {
    const stream = {};
    let filledCount = 0;

    formFields.forEach(field => {
      const input = document.getElementById(field);
      if (input) {
        stream[field] = input.value || '[EMPTY]';
        if (input.value) filledCount++;
      }
    });

    if (domPreviewBox) {
      domPreviewBox.textContent = JSON.stringify(stream, null, 2);
    }
  }

  // Auto-format Aadhaar spacing (XXXX XXXX XXXX)
  const aadhaarInput = document.getElementById('aadhaar');
  if (aadhaarInput) {
    aadhaarInput.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '').substring(0, 12);
      let formatted = '';
      for (let i = 0; i < val.length; i++) {
        if (i > 0 && i % 4 === 0) formatted += ' ';
        formatted += val[i];
      }
      e.target.value = formatted;
      updateLiveDomStream();
    });
  }

  // Auto-format PAN uppercase
  const panInput = document.getElementById('pan');
  if (panInput) {
    panInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
      updateLiveDomStream();
    });
  }

  // Event Listeners for all inputs to update live stream
  formFields.forEach(field => {
    const input = document.getElementById(field);
    if (input) {
      input.addEventListener('input', updateLiveDomStream);
      input.addEventListener('change', updateLiveDomStream);
    }
  });

  // Profile selector change
  if (profileSelect) {
    profileSelect.addEventListener('change', (e) => {
      loadProfile(e.target.value);
    });
  }

  // Quick action buttons
  if (quickFillBtn) {
    quickFillBtn.addEventListener('click', () => {
      if (profileSelect) profileSelect.value = 'profile-1';
      loadProfile('profile-1');
    });
  }

  if (quickClearBtn) {
    quickClearBtn.addEventListener('click', () => {
      if (profileSelect) profileSelect.value = 'empty';
      clearForm();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (profileSelect) profileSelect.value = 'empty';
      clearForm();
    });
  }

  // Form submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    alert('✅ Step 1 (Personal Info) validated! In a full demo, this navigates to Step 2 (Medical History).');
  });

  // Initial pre-fill with Rahul Sharma (Profile 1) per Day 1 deliverable requirements
  loadProfile('profile-1');
});
