// Convert a phone number to a synthetic email so Supabase email/password auth works as "phone auth"
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits;
}
export function phoneToEmail(phone: string): string {
  const digits = normalizePhone(phone);
  return `${digits}@phone.nexus`;
}
export function isValidPhone(input: string): boolean {
  const digits = normalizePhone(input);
  return digits.length >= 7 && digits.length <= 15;
}
