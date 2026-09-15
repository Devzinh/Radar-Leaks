import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createSession, validSession, verifySignature, hashPassword, verifyPassword } from '../src/security.js';
test('webhook authenticates exact bytes, rejecting tampering and missing secrets', () => {
  const raw = Buffer.from('{"hello":true}'); const secret = 'unit-test-secret';
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  assert.equal(verifySignature(raw, signature, secret), true);
  assert.equal(verifySignature(Buffer.from('{}'), signature, secret), false);
  assert.equal(verifySignature(raw, '', secret), false);
  assert.equal(verifySignature(raw, signature, ''), false);
});
test('session rejects tampering, wrong signing key and expiration', () => {
  const now = Date.now(); const token = createSession('secret', now);
  assert.equal(validSession(token, 'secret', now), true);
  assert.equal(validSession(`${token}x`, 'secret', now), false);
  assert.equal(validSession(token, 'other', now), false);
  assert.equal(validSession(token, 'secret', now + 28800001), false);
});
test('salted password hash rejects wrong and invalid inputs', () => {
  const hash = hashPassword('test-long-password');
  assert.equal(verifyPassword('test-long-password', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  assert.equal(verifyPassword(null, hash), false);
});
