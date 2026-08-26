# ArogyaShield Health Insurance — Mock Portal

A realistic Indian healthcare claim application designed specifically to benchmark and demonstrate **ShieldBrowse** (On-Device Visual Perception & PII Redaction Browser Agent).

---

## 🚀 Running the Mock Site

```bash
# In e:\SIH26\mock-site
npm install
npm run dev
```
The site will run at **`http://localhost:3000`**.

---

## 📋 Page 1: Personal Information (High PII Density)

Page 1 contains **14+ form inputs** covering various PII categories:

| Field | Element ID | PII Category | Verification / Checksum |
|---|---|---|---|
| Full Name | `#fullName` | Free-text NER (PERSON) | — |
| Date of Birth | `#dob` | Date PII | ISO Format |
| Gender | `#gender` | Categorical | — |
| Aadhaar Number | `#aadhaar` | Structured ID | Verhoeff Checksum (12 digits) |
| PAN Card | `#pan` | Structured ID | 5 Alpha + 4 Digit + 1 Alpha |
| Primary Phone | `#phone` | Contact | Indian Mobile (+91) |
| Email Address | `#email` | Contact | RFC Email pattern |
| Street Address | `#address` | Free-text NER (LOCATION) | — |
| City / District | `#city` | Location | — |
| State | `#state` | Location | — |
| PIN Code | `#pincode` | Structured ID | 6-digit Indian Pincode |
| Policy Number | `#policyNumber` | Identifier (Contextual) | — |
| Beneficiary ID | `#memberId` | Identifier (Contextual) | — |
| Nominee / Contact | `#emergencyContactName` | Free-text NER (PERSON) | — |
| Nominee Phone | `#emergencyContactPhone` | Contact | Indian Mobile (+91) |

---

## ⚡ Pre-configured Demo Profiles (`demo-profiles.js`)
1. **Rahul Sharma** (`profile-1`): Bengaluru salaried employee (Default pre-fill)
2. **Dr. Ananya Iyer** (`profile-2`): Chennai healthcare consultant
3. **Vikramjit Singh** (`profile-3`): New Delhi merchant
