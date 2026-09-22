import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
} from 'node:crypto';
import { env } from './config.js';

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 32;

/** Password hashing: scrypt with per-user salt, encoded as `salt:hash` hex. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize('NFKC'), salt, KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
  });
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [saltHex, hashHex] = encoded.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password.normalize('NFKC'), salt, expected.length, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Session tokens: 32 random bytes, only the SHA-256 is stored server-side. */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token) };
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * AES-256-GCM box for user GitHub PATs at rest.
 * Returns { ciphertext, nonce } base64. Requires TOKEN_ENC_KEY (32-byte hex).
 */
export function encryptSecret(plaintext: string): { ciphertext: string; nonce: string } {
  const key = encKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([ct, tag]).toString('base64'),
    nonce: nonce.toString('base64'),
  };
}

export function decryptSecret(ciphertext: string, nonce: string): string {
  const key = encKey();
  const raw = Buffer.from(ciphertext, 'base64');
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(0, raw.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function encKey(): Buffer {
  if (!env.TOKEN_ENC_KEY) {
    throw new Error('TOKEN_ENC_KEY (64-char hex) is required to store GitHub tokens');
  }
  return Buffer.from(env.TOKEN_ENC_KEY, 'hex');
}
