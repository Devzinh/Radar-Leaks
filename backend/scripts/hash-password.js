import { hashPassword } from '../src/security.js';
if (!process.argv[2] || process.argv[2].length < 12) throw new Error('Provide a password with at least 12 characters.');
console.log(hashPassword(process.argv[2]));
