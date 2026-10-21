import languages from '@cospired/i18n-iso-languages';

/** Normalize known lowercase ISO 639-2 bibliographic or terminological codes. */
export function canonicalLanguageCode(code: string): string | null {
  if (!/^[a-z]{3}$/.test(code)) {
    return null;
  }
  if (languages.getAlpha3TCodes()[code] !== undefined) {
    return code;
  }
  const alpha2 = languages.alpha3BToAlpha2(code);
  return (alpha2 && languages.alpha2ToAlpha3T(alpha2)) ?? null;
}
