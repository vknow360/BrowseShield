// app.js — Interactive logic for ArogyaShield Claim Portal (Multi-page version)
import { DEMO_PROFILES } from './demo-profiles.js';

document.addEventListener('DOMContentLoaded', () => {
  const profileSelect = document.getElementById('profileSelect');
  const quickFillBtn = document.getElementById('quickFillBtn');
  const quickClearBtn = document.getElementById('quickClearBtn');
  const resetBtn = document.getElementById('resetBtn');
  const domPreviewBox = document.getElementById('domPreviewBox');
  const reviewSummaryContainer = document.getElementById('reviewSummaryContainer');
  
  // All possible form fields across all steps
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

  // Helper to load a profile into sessionStorage
  function loadProfile(profileId) {
    if (profileId === 'empty') {
      clearFormSession();
      return;
    }
    const profile = DEMO_PROFILES.find(p => p.id === profileId);
    if (!profile) {
      clearFormSession();
      return;
    }

    formFields.forEach(field => {
      if (profile[field] !== undefined) {
        sessionStorage.setItem(`form_${field}`, profile[field]);
      } else {
        sessionStorage.removeItem(`form_${field}`);
      }
    });

    // Populate current page fields
    populateFieldsFromSession();
    updateLiveDomStream();
  }

  function clearFormSession() {
    formFields.forEach(field => {
      sessionStorage.removeItem(`form_${field}`);
    });
    populateFieldsFromSession();
    updateLiveDomStream();
  }

  // Restore current page's fields from sessionStorage
  function populateFieldsFromSession() {
    formFields.forEach(field => {
      const input = document.getElementById(field);
      if (input) {
        const storedValue = sessionStorage.getItem(`form_${field}`);
        input.value = storedValue || '';
      }
    });
  }

  // Save current page's fields to sessionStorage on input
  formFields.forEach(field => {
    const input = document.getElementById(field);
    if (input) {
      input.addEventListener('input', (e) => {
        sessionStorage.setItem(`form_${field}`, e.target.value);
        updateLiveDomStream();
      });
      input.addEventListener('change', (e) => {
        sessionStorage.setItem(`form_${field}`, e.target.value);
        updateLiveDomStream();
      });
    }
  });

  function updateLiveDomStream() {
    const stream = {};
    let filledCount = 0;

    formFields.forEach(field => {
      // For multi-page, we show what is in the DOM of the *current* page for the preview,
      // but BrowseShield reads the DOM anyway. For debug box, we just show sessionStorage.
      const val = sessionStorage.getItem(`form_${field}`);
      if (val) {
        stream[field] = val;
        filledCount++;
      } else {
        stream[field] = '[EMPTY]';
      }
    });

    if (domPreviewBox) {
      domPreviewBox.textContent = JSON.stringify(stream, null, 2);
    }
  }

  // Populate review summary on Step 4
  function populateReviewSummary() {
    if (!reviewSummaryContainer) return;
    
    const getVal = (id) => sessionStorage.getItem(`form_${id}`) || 'N/A';
    
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
        <div><strong>Estimated Treatment:</strong> ₹${Number(getVal('treatmentCost') || 0).toLocaleString('en-IN')}</div>
      </div>
      
      <div style="background: #f8fafc; border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
        <h4 style="margin: 0 0 8px 0; color: var(--primary-color);">💳 Reimbursement Account</h4>
        <div><strong>Account Holder:</strong> ${getVal('accountHolderName')}</div>
        <div><strong>Bank:</strong> ${getVal('bankName')} | <strong>IFSC:</strong> ${getVal('ifscCode')}</div>
        <div><strong>Account Number:</strong> ••••••••••••${(getVal('accountNumber')).slice(-4)}</div>
      </div>
    `;
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
      sessionStorage.setItem('form_aadhaar', formatted);
      updateLiveDomStream();
    });
  }

  // Auto-format PAN uppercase
  const panInput = document.getElementById('pan');
  if (panInput) {
    panInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
      sessionStorage.setItem('form_pan', e.target.value);
      updateLiveDomStream();
    });
  }

  // Profile selector change
  if (profileSelect) {
    profileSelect.addEventListener('change', (e) => {
      loadProfile(e.target.value);
      // Optional: automatically navigate to step 1 if not already there
      if (!window.location.pathname.includes('healthcare-step1.html')) {
        window.location.href = 'healthcare-step1.html';
      }
    });
    // Set initial value to 'empty' to avoid re-triggering load on every page load unless it's step 1
    if (window.location.pathname.includes('healthcare-step1.html')) {
        // Only auto-load profile on step 1 if sessionStorage is empty
        if (!sessionStorage.getItem('form_policyNumber')) {
            loadProfile('profile-1');
            profileSelect.value = 'profile-1';
        }
    }
  }

  // Quick action buttons
  if (quickFillBtn) {
    quickFillBtn.addEventListener('click', () => {
      if (profileSelect) profileSelect.value = 'profile-1';
      loadProfile('profile-1');
      if (!window.location.pathname.includes('healthcare-step1.html')) {
        window.location.href = 'healthcare-step1.html';
      }
    });
  }

  if (quickClearBtn || resetBtn) {
    const btn = quickClearBtn || resetBtn;
    btn.addEventListener('click', () => {
      if (profileSelect) profileSelect.value = 'empty';
      clearFormSession();
      if (!window.location.pathname.includes('healthcare-step1.html')) {
        window.location.href = 'healthcare-step1.html';
      }
    });
  }

  // Handle Patient Photo Upload
  const photoUpload = document.getElementById('photo-upload');
  const patientPhoto = document.getElementById('patient-photo');
  if (photoUpload && patientPhoto) {
    photoUpload.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          patientPhoto.src = event.target.result;
          sessionStorage.setItem('form_photo', event.target.result);
        };
        reader.readAsDataURL(file);
      }
    });
    
    // Restore photo
    const storedPhoto = sessionStorage.getItem('form_photo');
    if (storedPhoto) {
      patientPhoto.src = storedPhoto;
    }
  }

  // Initialize page
  populateFieldsFromSession();
  populateReviewSummary();
  updateLiveDomStream();
});
