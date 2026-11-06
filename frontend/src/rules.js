// Contraintes de saisie communes (les mêmes règles sont revérifiées côté serveur)
export const NOM = { minLength: 2, maxLength: 60, pattern: "\\p{L}[\\p{L}\\p{M} '’.\\-]*", title: 'Lettres, espaces, apostrophes et tirets (2 à 60 caractères)' };
export const LIBELLE = (max = 100) => ({ minLength: 2, maxLength: max, pattern: "[\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M} '’.,&\\(\\)\\/+–—\\-]*", title: `2 à ${max} caractères : lettres, chiffres, espaces et . , & ( ) / + - '` });
export const ANNEE = { maxLength: 9, pattern: '\\d{4}-\\d{4}', placeholder: '2026-2027', title: 'Format 2026-2027' };
export const EMAIL = { maxLength: 120 };
export const MOT_DE_PASSE = { minLength: 8, maxLength: 72, pattern: '(?=.*\\p{L})(?=.*\\d).{8,72}', title: '8 à 72 caractères, avec au moins une lettre et un chiffre' };
