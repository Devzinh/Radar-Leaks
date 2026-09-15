import { handleRequest } from '../../backend/src/api.js';
import { kickWorker } from '../../backend/src/worker.js';
import { environment } from './_shared/environment';

export default async (request, context) => {
  const env = environment();
  return handleRequest(request, { env, ip: context.ip || 'unknown', kick: () => kickWorker(env) });
};
export const config = { path: ['/api/health', '/api/login', '/api/logout', '/api/dashboard', '/api/findings/:id', '/api/webhooks/github'] };
