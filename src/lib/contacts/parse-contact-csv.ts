import { withBrazilCountryCode } from '@/lib/whatsapp/phone-utils';

/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

/**
 * Header aliases per field, EN + PT-BR — real-world exports (a phone
 * shop's own client list, a spreadsheet someone built by hand) show up
 * with Portuguese headers ("Telefone", "Nome") far more often than the
 * English ones the original template used, and there's no reason to
 * reject a file just because its header is in the account's own
 * language. Matched case-insensitively after the header row is
 * lowercased below, so list the aliases in lowercase.
 */
const FIELD_ALIASES = {
  phone: ['phone', 'telefone', 'celular', 'whatsapp'],
  name: ['name', 'nome'],
  email: ['email', 'e-mail'],
  company: ['company', 'empresa'],
  tags: ['tags', 'etiquetas'],
} as const;

function findColumn(headers: string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Excel saved under a PT-BR (or most other European) locale exports
 * CSV with `;` as the field separator, not `,` — because `,` is
 * already the decimal separator in that locale. Detected from the
 * header row: whichever character splits it into more fields wins.
 * Falls back to `,` when the row has neither (single-column files,
 * or truly comma-delimited ones).
 */
function detectDelimiter(headerLine: string): ',' | ';' {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

/**
 * A phone cell that survived a round-trip through Excel as a number
 * column: "81982169570" gets auto-typed as a number, then rendered in
 * scientific notation ("5,58E+12" or "5.58E+12") once it's wider than
 * Excel's default column width. The original digits are gone by the
 * time we see the file — there's nothing to recover, only to detect
 * and report clearly instead of silently importing 5-6 garbage digits.
 */
function looksLikeExcelScientificNotation(value: string): boolean {
  return /^\d+[.,]\d+e\+?\d+$/i.test(value.trim());
}

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
  /**
   * Rows skipped because their phone cell was Excel scientific
   * notation (e.g. "5,58E+12") — the original number is unrecoverable
   * from the file itself. Surfaced so the UI can tell the user why,
   * instead of silently importing fewer rows than expected.
   */
  corruptedPhoneCount: number;
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false, corruptedPhoneCount: 0 };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

  const phoneIdx = findColumn(headers, FIELD_ALIASES.phone);
  if (phoneIdx === -1) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false, corruptedPhoneCount: 0 };
  }

  const nameIdx = findColumn(headers, FIELD_ALIASES.name);
  const emailIdx = findColumn(headers, FIELD_ALIASES.email);
  const companyIdx = findColumn(headers, FIELD_ALIASES.company);
  const tagsIdx = findColumn(headers, FIELD_ALIASES.tags);

  const rows: ParsedContactRow[] = [];
  let corruptedPhoneCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line, delimiter);
    const rawPhone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!rawPhone) continue;
    if (looksLikeExcelScientificNotation(rawPhone)) {
      corruptedPhoneCount++;
      continue;
    }
    // Digits-only from here down (matches how the manual contact form
    // and the WhatsApp webhook already store phone). Spreadsheet
    // exports rarely carry a country code — a bare "81982169570" gets
    // the 55 prefix so it's actually usable for WhatsApp; anything
    // that already has a country code, or an explicit +, is left as
    // just its digits.
    const phone = withBrazilCountryCode(rawPhone);

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
    corruptedPhoneCount,
  };
}

/** Simple CSV line parse (handles quoted fields). */
function parseCsvLine(line: string, delimiter: ',' | ';' = ','): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
