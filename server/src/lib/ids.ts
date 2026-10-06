import crypto from 'node:crypto';

/** Random, URL-safe identifier for primary keys. */
export const newId = () => crypto.randomUUID();

// Crockford base32 without I, L, O, U — unambiguous when read aloud at a venue desk.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Public registration code, e.g. CUTM-8F92KD. Uniqueness is enforced by the database. */
export const newRegistrationCode = () => {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `CUTM-${code}`;
};

/** Opaque session token for the cookie, plus the hash stored in the database. */
export const newSessionToken = () => {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, id: hashToken(token) };
};

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'event';
