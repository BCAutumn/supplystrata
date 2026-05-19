export function normalizeCik(cik: string): string {
  const digits = cik.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 10) throw new Error(`Invalid CIK: ${cik}`);
  return digits.padStart(10, "0");
}
