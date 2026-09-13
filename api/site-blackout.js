// Public, tiny, fast blackout flag. The game shell fetches this before it
// renders anything so the admin kill switch can black out the whole site for
// every visitor. A read failure must never black out the site by itself, so it
// fails open (enabled: false).

import { api } from '../convex/_generated/api.js';
import { convexClient } from '../server/convexClient.js';
import { secureJson } from '../server/httpSecurity.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return secureJson(response, 405, { error: 'Method not allowed' });
  try {
    const flag = await convexClient().query(api.chain.siteBlackout, {});
    return secureJson(response, 200, { blackout: Boolean(flag?.enabled) });
  } catch {
    return secureJson(response, 200, { blackout: false });
  }
}
