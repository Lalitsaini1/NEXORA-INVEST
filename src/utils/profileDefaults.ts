import { normalizeIndianMobile } from './validators';

export interface DefaultProfileInputs {
  fullName: string;
  email: string;
  mobile: string;
  authProvider: 'password' | 'phone' | 'password+phone';
}

/**
 * Derives a valid display name (2..80 chars) required by Firestore security rules
 * from an authenticated Firebase User's displayName or email local-part.
 */
export function deriveDefaultFullName(
  displayName?: string | null,
  email?: string | null
): string {
  const cleanedDisplay = (displayName ?? '').trim().replace(/\s+/g, ' ');
  if (cleanedDisplay.length >= 2) {
    return cleanedDisplay.slice(0, 80).trim();
  }

  const localPart = (email ?? '')
    .trim()
    .split('@')[0]
    ?.replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (localPart && localPart.length >= 2) {
    const formatted = localPart
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    if (formatted.length >= 2) {
      return formatted.slice(0, 80).trim();
    }
  }

  return 'NEXORA Member';
}

/**
 * Normalizes an authenticated Firebase User's identity metadata into schema-compliant
 * default fields (while never elevating role beyond 'USER' client-side).
 */
export function buildDefaultProfileInputs(params: {
  displayName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
}): DefaultProfileInputs {
  const cleanEmail = (params.email ?? '').trim().toLowerCase().slice(0, 160);
  const rawPhone = (params.phoneNumber ?? '').trim();

  let cleanMobile = '';
  if (rawPhone) {
    if (rawPhone.startsWith('+') && /^\+[0-9]{8,15}$/.test(rawPhone)) {
      cleanMobile = rawPhone.slice(0, 20);
    } else {
      cleanMobile = normalizeIndianMobile(rawPhone).slice(0, 20);
    }
  }

  const authProvider: DefaultProfileInputs['authProvider'] =
    cleanMobile && cleanEmail
      ? 'password+phone'
      : cleanMobile
      ? 'phone'
      : 'password';

  return {
    fullName: deriveDefaultFullName(params.displayName, cleanEmail),
    email: cleanEmail,
    mobile: cleanMobile,
    authProvider,
  };
}
