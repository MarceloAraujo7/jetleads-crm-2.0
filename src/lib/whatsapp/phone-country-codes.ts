/** Country dial codes offered in the "Ligar" (PHONE_NUMBER) button
 *  editor — not exhaustive, just the accounts' actual markets plus
 *  common neighbors. `digits` combines with the button's raw number
 *  input into the E.164-ish string Meta's PHONE_NUMBER button expects. */
export interface CountryCode {
  iso: string;
  label: string;
  digits: string;
}

export const COUNTRY_CODES: CountryCode[] = [
  { iso: "BR", label: "Brasil", digits: "55" },
  { iso: "US", label: "EUA", digits: "1" },
  { iso: "PT", label: "Portugal", digits: "351" },
  { iso: "AR", label: "Argentina", digits: "54" },
  { iso: "MX", label: "México", digits: "52" },
  { iso: "ES", label: "Espanha", digits: "34" },
];

/** Splits a stored `+5511999999999` back into (country digits, rest)
 *  for editing — falls back to Brasil when the prefix doesn't match
 *  anything in the list (e.g. a number synced from Meta). */
export function splitPhoneNumber(phoneNumber: string): { countryDigits: string; rest: string } {
  const digitsOnly = phoneNumber.replace(/\D/g, "");
  const match = COUNTRY_CODES.find((c) => digitsOnly.startsWith(c.digits));
  if (!match) return { countryDigits: COUNTRY_CODES[0].digits, rest: digitsOnly };
  return { countryDigits: match.digits, rest: digitsOnly.slice(match.digits.length) };
}

export function combinePhoneNumber(countryDigits: string, rest: string): string {
  return `+${countryDigits}${rest.replace(/\D/g, "")}`;
}
