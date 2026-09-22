import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, newSessionToken, encryptSecret, decryptSecret } from '../src/crypto.js';

describe('passwords', () => {
  it('hashes with unique salts and verifies', () => {
    const a = hashPassword('correct horse battery staple');
    const b = hashPassword('correct horse battery staple');
    expect(a).not.toBe(b); // per-user salt
    expect(verifyPassword('correct horse battery staple', a)).toBe(true);
    expect(verifyPassword('wrong password', a)).toBe(false);
  });

  it('rejects malformed encoded hashes', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false);
    expect(verifyPassword('x', 'onlyonepart')).toBe(false);
  });
});

describe('sessions', () => {
  it('tokens are url-safe and only the hash is comparable', () => {
    const { token, tokenHash } = newSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(token);
  });
});

describe('secret box', () => {
  it('AES-256-GCM roundtrips with auth tag', () => {
    const secret = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    const box = encryptSecret(secret);
    expect(box.ciphertext).not.toContain(secret);
    expect(decryptSecret(box.ciphertext, box.nonce)).toBe(secret);
  });

  it('distinct nonces → distinct ciphertexts', () => {
    const secret = 'gho_repetitiontest123';
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.nonce).not.toBe(b.nonce);
  });
});
