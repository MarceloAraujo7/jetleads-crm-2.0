import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseTagCell } from './parse-contact-csv';

describe('parseTagCell', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    expect(parseTagCell(' VIP , Lead ,  ')).toEqual(['VIP', 'Lead']);
  });

  it('splits semicolon-separated tags', () => {
    expect(parseTagCell('VIP; Lead; Customer')).toEqual([
      'VIP',
      'Lead',
      'Customer',
    ]);
  });

  it('de-dupes case-insensitively', () => {
    expect(parseTagCell('vip, VIP, Lead')).toEqual(['vip', 'Lead']);
  });

  it('returns empty for blank values', () => {
    expect(parseTagCell('')).toEqual([]);
    expect(parseTagCell(undefined)).toEqual([]);
  });
});

describe('parseContactCsv', () => {
  it('parses optional tags column', () => {
    const csv = `phone,name,tags
+15551234567,Alice,"VIP, Lead"
+15559876543,Bob,Customer`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: true,
      hasCompanyColumn: false,
      rows: [
        {
          // An explicit + means "trust this as a complete
          // international number" — stripped to digits (matches how
          // the webhook stores phone) but never guessed at.
          phone: '15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: ['VIP', 'Lead'],
        },
        {
          phone: '15559876543',
          name: 'Bob',
          email: undefined,
          company: undefined,
          tagNames: ['Customer'],
        },
      ],
    });
  });

  it('returns empty tagNames when tags column is absent', () => {
    const csv = `phone,name
+15551234567,Alice`;

    expect(parseContactCsv(csv)).toEqual({
      hasTagsColumn: false,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: [],
        },
      ],
    });
  });

  it('accepts Portuguese headers in any column order', () => {
    const csv = `Nome,Telefone
Maria Silva,81982169570
João,8396665150`;

    const result = parseContactCsv(csv);
    expect(result.rows).toEqual([
      // Bare 11-digit (DDD + 9-digit mobile) and 10-digit (DDD +
      // 8-digit landline) numbers both get the 55 country code —
      // real spreadsheet exports never carry one.
      { phone: '5581982169570', name: 'Maria Silva', email: undefined, company: undefined, tagNames: [] },
      { phone: '558396665150', name: 'João', email: undefined, company: undefined, tagNames: [] },
    ]);
  });

  it('accepts "celular"/"whatsapp" as phone aliases and "empresa"/"etiquetas" for company/tags', () => {
    const csv = `nome,celular,empresa,etiquetas
Ana,11988887777,Empresa X,vip`;

    const result = parseContactCsv(csv);
    expect(result.hasCompanyColumn).toBe(true);
    expect(result.hasTagsColumn).toBe(true);
    expect(result.rows).toEqual([
      { phone: '5511988887777', name: 'Ana', email: undefined, company: 'Empresa X', tagNames: ['vip'] },
    ]);
  });

  it('leaves a phone with a country code already present untouched (just digits)', () => {
    const csv = `telefone,nome
5581982169570,Carlos`;

    expect(parseContactCsv(csv).rows).toEqual([
      { phone: '5581982169570', name: 'Carlos', email: undefined, company: undefined, tagNames: [] },
    ]);
  });
});
