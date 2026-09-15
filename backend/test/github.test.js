import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, createVerify } from 'node:crypto';
import { GitHub, parsePrivateKey } from '../src/github.js';

test('RSA PEM survives multiline, escaped and space-flattened environment values', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const type of ['pkcs1', 'pkcs8']) {
    const pem = privateKey.export({ type, format: 'pem' });
    for (const value of [pem, pem.replaceAll('\n', '\\n'), pem.replaceAll('\n', ' ')]) {
      const key = parsePrivateKey(value);
      const signature = createSign('RSA-SHA256').update('synthetic payload').sign(key);
      assert.equal(createVerify('RSA-SHA256').update('synthetic payload').verify(publicKey, signature), true);
    }
  }
  assert.throws(() => parsePrivateKey('not a key'), /GitHub private key is invalid/);
  assert.throws(() => parsePrivateKey('-----BEGIN RSA PRIVATE KEY-----invalid-----END RSA PRIVATE KEY-----'), /GitHub private key is invalid/);
});

test('commit extraction scans additions with actual line numbers and flags missing patches', async () => {
  const github = new GitHub({});
  github.token = async () => 'synthetic';
  github.request = async (path) => path.includes('/commits/') ? ({ files: [
    { filename: 'config.py', status: 'modified', patch: '@@ -8,3 +8,4 @@\n context\n-old\n+new\n+another\n context' },
    { filename: 'image.png', status: 'added' },
    { filename: 'deleted.txt', status: 'removed' },
  ] }) : ({ private: false });
  const result = await github.addedText('example/project', 'a'.repeat(40));
  assert.equal(result.partial, true);
  assert.deepEqual(result.files, [{ path: 'config.py', additions: [{ text: 'new', line: 9 }, { text: 'another', line: 10 }] }]);
});

test('scanner rejects private repositories before fetching any commit content', async () => {
  const github = new GitHub({}); let requests = 0;
  github.token = async () => 'synthetic';
  github.request = async () => { requests++; return { private: true }; };
  await assert.rejects(github.addedText('example/repo', 'a'.repeat(40)), /not public/);
  assert.equal(requests, 1);
  await assert.rejects(github.addedText('../bad/path', 'a'.repeat(40)), /Invalid commit target/);
  assert.equal(requests, 1);
});
