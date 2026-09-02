export function isValidAadharNumber(num) {
  const clean = String(num).replace(/[\s-]/g, "");
  if (clean.length !== 12 || /^[01]/.test(clean) || !/^\d{12}$/.test(clean)) {
    return false;
  }

  // Verhoeff Algorithm Tables
  const D_TABLE = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];

  const P_TABLE = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  let c = 0;

  clean
    .split("")
    .reverse()
    .forEach((digit, i) => {
      const p_val = P_TABLE[i % 8][parseInt(digit, 10)];
      c = D_TABLE[c][p_val];
    });

  return c === 0;
}

export function isValidPhoneNumber(num) {
  const digits = String(num)
    .replace(/[\s-]/g, "")
    .replace(/^(?:\+91|0)/, "");
  return /^[6-9]\d{9}$/.test(digits);
}

export function isValidPincode(num) {
  // Indian Pincode Validation: 6 digits starting with 1-9.
  const pincodeRegex = /^[1-9]\d{5}$/;
  return pincodeRegex.test(num);
}

export function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

export function isValidPan(pan) {
  const clean = String(pan).replace(/[\s-]/g, "").toUpperCase();
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  return panRegex.test(clean);
}

export function isValidCreditCard(numberOrString) {
  // Convert to string and remove all whitespaces/dashes
  const cleanStr = String(numberOrString).replace(/\s+/g, "").replace(/-/g, "");

  // Return false if empty or contains non-digits
  if (!cleanStr || !/^\d+$/.test(cleanStr)) return false;

  let sum = 0;
  let shouldDouble = false;

  // Loop through digits from right to left
  for (let i = cleanStr.length - 1; i >= 0; i--) {
    let digit = parseInt(cleanStr.charAt(i), 10);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9; // Equivalent to adding the two digits together
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble; // Alternate for the next digit
  }

  return sum % 10 === 0;
}

export function isValidIFSC(code) {
  const clean = String(code).replace(/[\s-]/g, "").toUpperCase();
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  return ifscRegex.test(clean);
}
