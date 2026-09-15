import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../src/github.js';

test('commit extraction scans additions with actual line numbers and flags missing patches', async () => {
  const github = new GitHub({});
  github.token = async () => 'synthetic';
  github.request = async () => ({ files: [
    { filename: 'config.py', status: 'modified', patch: '@@ -8,3 +8,4 @@\n context\n-old\n+new\n+another\n context' },
    { filename: 'image.png', status: 'added' },
    { filename: 'deleted.txt', status: 'removed' },
  ] });
  const result = await github.addedText('example/project', 'a'.repeat(40));
  assert.equal(result.partial, true);
  assert.deepEqual(result.files, [{ path: 'config.py', additions: [{ text: 'new', line: 9 }, { text: 'another', line: 10 }] }]);
});
