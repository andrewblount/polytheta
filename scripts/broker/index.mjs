import { TwsBroker } from './tws.mjs';
import { WebApiBroker } from './web-api.mjs';
export function createBroker(settings) {
  return settings.connection === 'web-api' ? new WebApiBroker() : new TwsBroker();
}
