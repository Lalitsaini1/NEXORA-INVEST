export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Email address is required.';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) return 'Enter a valid email address.';
  return null;
}

export function validateIndianMobile(mobile: string): string | null {
  const digits = mobile.replace(/\D/g, '');
  const normalized = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(normalized)) {
    return 'Enter a valid 10-digit Indian mobile number.';
  }
  return null;
}

export function normalizeIndianMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  const tenDigit = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  return `+91${tenDigit}`;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Include at least one uppercase letter and one number.';
  }
  return null;
}

export function validateOtpCode(otp: string): string | null {
  if (!/^\d{6}$/.test(otp.trim())) {
    return 'Enter the 6-digit verification code.';
  }
  return null;
}

export function validateFullName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return 'Enter your full name (at least 2 characters).';
  if (trimmed.length > 80) return 'Full name must be 80 characters or fewer.';
  return null;
}
