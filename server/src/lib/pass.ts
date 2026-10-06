import crypto from 'node:crypto';

/**
 * Signed QR pass tokens (blueprint §4.9, §9.3).
 *
 * The QR code on a pass encodes `<payload>.<signature>`, where the payload
 * names the registration and event and the signature is an HMAC-SHA256 over
 * it. Tokens can't be guessed or forged without the server secret. They
 * don't carry a status: the scanner looks the registration up on every scan,
 * so a cancelled registration is rejected even with a valid token.
 */

interface PassPayload {
  v: 1;
  r: string; // registration id
  e: string; // event id
}

const sign = (data: string, secret: string) =>
  crypto.createHmac('sha256', secret).update(data).digest('base64url');

export const createPassToken = (registrationId: string, eventId: string, secret: string) => {
  const payload: PassPayload = { v: 1, r: registrationId, e: eventId };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data, secret)}`;
};

export const verifyPassToken = (token: string, secret: string): { registrationId: string; eventId: string } | null => {
  const [data, signature, extra] = token.split('.');
  if (!data || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(data, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as Partial<PassPayload>;
    if (payload.v !== 1 || typeof payload.r !== 'string' || typeof payload.e !== 'string') return null;
    return { registrationId: payload.r, eventId: payload.e };
  } catch {
    return null;
  }
};
