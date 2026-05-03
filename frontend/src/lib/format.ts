/**
 * Format a phone number string as (XXX) XXX-XXXX.
 * Strips non-digits, caps at 10 digits.
 */
export const formatPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
};

/**
 * Format a phone number for display. Returns formatted string or original if empty/null.
 */
export const displayPhone = (value: string | null | undefined): string => {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return value; // return as-is if not standard length
};
