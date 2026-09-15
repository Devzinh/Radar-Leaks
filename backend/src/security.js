import { createHmac, timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';
export function equal(a, b) {
  const left = Buffer.from(a || ''); const right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifySignature(body, signature, secret) {
  return Boolean(secret) && equal(signature, `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
}
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 1024 || !stored) return false;
  const [salt, hash] = stored.split(':');
  return Boolean(salt && hash) && equal(scryptSync(password, salt, 64).toString('hex'), hash);
}
export function createSession(secret, now = Date.now()) {
  const payload = `${now + 8 * 60 * 60 * 1000}.${randomBytes(16).toString('hex')}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`;
}
export function validSession(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string') return false;
  const [expires, nonce, signature, extra] = token.split('.');
  return !extra && Number(expires) > now && equal(signature, createHmac('sha256', secret).update(`${expires}.${nonce}`).digest('hex'));
}
