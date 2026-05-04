// Thai national ID (13-digit) validation
//
// Algorithm: digits 1-12 are weighted by [13, 12, 11, ..., 2], summed,
// then `(11 - sum % 11) % 10` must equal digit 13.
// Reference: Department of Provincial Administration spec.

export function isValidThaiNid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i], 10) * (13 - i);
  }
  const checksum = (11 - (sum % 11)) % 10;
  return checksum === parseInt(digits[12], 10);
}

// Format 1234567890123 → 1-2345-67890-12-3
export function formatThaiNid(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 1) return d;
  if (d.length <= 5) return `${d.slice(0, 1)}-${d.slice(1)}`;
  if (d.length <= 10) return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10)}`;
  return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d.slice(12)}`;
}
