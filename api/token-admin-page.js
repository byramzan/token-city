// `/token-admin.html` is served by this function through a Vercel rewrite, so
// the operations markup only ever leaves the server for an authenticated
// session (task8 §7.1). No static file with this content is published.

import { adminContext } from './admin-session.js';
import { consolePage, loginPage } from '../server/adminConsole.js';
import { networkForEnvironment } from '../server/chain/networks.js';

function html(response, status, body) {
  response.statusCode = status;
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.setHeader('cache-control', 'no-store, max-age=0, must-revalidate');
  response.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-frame-options', 'DENY');
  response.end(body);
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return html(response, 405, loginPage());
  const context = adminContext(request);
  if (!context) return html(response, 401, loginPage());
  const network = networkForEnvironment(process.env.VERCEL_ENV, process.env.RHC_ENVIRONMENT);
  return html(response, 200, consolePage({
    networkName: network.networkName,
    networkType: network.networkType,
    chainId: network.chainId,
    explorerBaseUrl: network.explorerBaseUrl,
  }));
}
