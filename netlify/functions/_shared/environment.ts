import { environmentKeys } from '../../../backend/src/config.js';
export function environment() {
  return { ...Object.fromEntries(environmentKeys.map(key => [key, Netlify.env.get(key)])), NODE_ENV: 'production' };
}
