// app.js — Interactive logic for ArogyaShield Claim Portal
import { DEMO_PROFILES } from './demo-profiles.js';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('claimForm');
  const profileSelect = document.getElementById('profileSelect');
  const quickFillBtn = document.getElementById('quickFillBtn');
  const quickClearBtn = document.getElementById('quickClearBtn');
  const resetBtn = document.getElementById('resetBtn');
  const domPreviewBox = document.getElementById('domPreviewBox');

  // Multi-step panels and buttons
  const stepPanels = [
    document.getElementById('step-1-panel'),
    document.getElementById('step-2-panel'),
    document.getElementById('step-3-panel'),
    document.getElementById('step-4-panel')
  ];
  const stepSuccessPanel = document.getElementById('step-success-panel');
  const stepItems = document.querySelectorAll('.stepper .step-item');
  const badgeTag = document.querySelector('.badge-tag');

  const step1NextBtn = document.getElementById('step1NextBtn');
  const step2BackBtn = document.getElementById('step2BackBtn');
  const step2NextBtn = document.getElementById('step2NextBtn');
  const step3BackBtn = document.getElementById('step3BackBtn');
  const step3NextBtn = document.getElementById('step3NextBtn');
  const step4BackBtn = document.getElementById('step4BackBtn');
  const restartClaimBtn = document.getElementById('restartClaimBtn');
  const reviewSummaryContainer = document.getElementById('reviewSummaryContainer');

  let currentStep = 1;

  // Input elements mapping across all steps
  const formFields = [
    // Step 1
    'policyNumber', 'memberId', 'fullName', 'dob', 'gender',
    'aadhaar', 'pan', 'phone', 'email', 'address', 'city',
    'state', 'pincode', 'emergencyContactName', 'emergencyContactPhone', 'relation',
    // Step 2
    'hospitalName', 'admissionDate', 'diagnosis', 'physicianName', 'treatmentCost', 'preExisting',
    // Step 3
    'accountHolderName', 'bankName', 'accountNumber', 'ifscCode', 'branchName'
  ];

  function goToStep(step) {
    currentStep = step;
    
    // Update step panels visibility
    stepPanels.forEach((panel, index) => {
      if (panel) {
        panel.style.display = (index + 1 === step) ? 'block' : 'none';
      }
    });
    if (stepSuccessPanel) stepSuccessPanel.style.display = 'none';

    // Update stepper progress indicators
    stepItems.forEach((item, index) => {
      const stepNum = index + 1;
      const statusSpan = item.querySelector('.step-status');
      item.classList.remove('active', 'completed');

      if (stepNum < step) {
        item.classList.add('completed');
        if (statusSpan) statusSpan.textContent = 'Completed';
      } else if (stepNum === step) {
        item.classList.add('active');
        if (statusSpan) statusSpan.textContent = 'In Progress';
      } else {
        if (statusSpan) statusSpan.textContent = 'Upcoming';
      }
    });

    if (badgeTag) badgeTag.textContent = `Step ${step} of 4`;

    // Populate review summary on Step 4
    if (step === 4) {
      populateReviewSummary();
    }

    updateLiveDomStream();

    // Trigger input event to make BrowseShield rescan the newly visible elements
    document.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function populateReviewSummary() {
    if (!reviewSummaryContainer) return;
    
    const getVal = (id) => document.getElementById(id)?.value || 'N/A';
    
    reviewSummaryContainer.innerHTML = `
      <div style="background: #f8fafc; border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 12px;">
        <h4 style="margin: 0 0 8px 0; color: var(--primary-color);">👤 Beneficiary Details</h4>
        <div><strong>Name:</strong> ${getVal('fullName')} | <strong>DOB:</strong> ${getVal('dob')} | <strong>Gender:</strong> ${getVal('gender')}</div>
        <div><strong>Policy No:</strong> ${getVal('policyNumber')} | <strong>Member ID:</strong> ${getVal('memberId')}</div>
        <div><strong>Aadhaar:</strong> ${getVal('aadhaar')} | <strong>PAN:</strong> ${getVal('pan')}</div>
        <div><strong>Contact:</strong> ${getVal('phone')} | ${getVal('email')}</div>
      </div>
      
      <div style="background: #f8fafc; border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 12px;">
        <h4 style="margin: 0 0 8px 0; color: var(--primary-color);">🏥 Medical & Hospitalization Details</h4>
        <div><strong>Hospital:</strong> ${getVal('hospitalName')}</div>
        <div><strong>Admission Date:</strong> ${getVal('admissionDate')} | <strong>Physician:</strong> ${getVal('physicianName')}</div>
        <div><strong>Diagnosis:</strong> ${getVal('diagnosis')}</div>
        <div><strong>Estimated Treatment:</strong> ₹${Number(getVal('treatmentCost')).toLocaleString('en-IN')}</div>
      </div>
      
      <div style="background: #f8fafc; border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
        <h4 style="margin: 0 0 8px 0; color: var(--primary-color);">💳 Reimbursement Account</h4>
        <div><strong>Account Holder:</strong> ${getVal('accountHolderName')}</div>
        <div><strong>Bank:</strong> ${getVal('bankName')} | <strong>IFSC:</strong> ${getVal('ifscCode')}</div>
        <div><strong>Account Number:</strong> ••••••••••••${getVal('accountNumber').slice(-4)}</div>
      </div>
    `;
  }

  // Step Navigation Event Handlers
  if (step1NextBtn) step1NextBtn.addEventListener('click', () => goToStep(2));
  if (step2BackBtn) step2BackBtn.addEventListener('click', () => goToStep(1));
  if (step2NextBtn) step2NextBtn.addEventListener('click', () => goToStep(3));
  if (step3BackBtn) step3BackBtn.addEventListener('click', () => goToStep(2));
  if (step3NextBtn) step3NextBtn.addEventListener('click', () => goToStep(4));
  if (step4BackBtn) step4BackBtn.addEventListener('click', () => goToStep(3));

  if (restartClaimBtn) {
    restartClaimBtn.addEventListener('click', () => {
      clearForm();
      if (profileSelect) profileSelect.value = 'profile-1';
      loadProfile('profile-1');
      goToStep(1);
    });
  }

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

  // Form submission (Final Step 4)
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    stepPanels.forEach(panel => { if (panel) panel.style.display = 'none'; });
    if (stepSuccessPanel) stepSuccessPanel.style.display = 'block';
    
    stepItems.forEach(item => {
      item.classList.remove('active');
      item.classList.add('completed');
      const statusSpan = item.querySelector('.step-status');
      if (statusSpan) statusSpan.textContent = 'Completed';
    });

    if (badgeTag) badgeTag.textContent = 'Claim Approved';
    document.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Initial load
  loadProfile('profile-1');
  goToStep(1);
});
