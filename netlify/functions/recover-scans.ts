import { kickWorker } from '../../backend/src/worker.js';
import { configuration } from '../../backend/src/config.js';
import { environment } from './_shared/environment';

export default async () => {
  const env = environment();
  if (configuration(env).configured) await kickWorker(env);
};
export const config = { schedule: '* * * * *' };
