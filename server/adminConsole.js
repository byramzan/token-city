// The protected operations console (task8 §7).
//
// The whole page is produced on the server. An unauthenticated request only
// ever receives the login shell: no field names, no configuration, no chain
// metadata and no script that could reveal one. The console markup is returned
// exclusively to a request that already carries a valid admin session.

const STYLE = `
:root { color-scheme: dark; --bg:#0e1117; --card:#161b25; --line:#242c3a; --ink:#e7ecf5; --muted:#93a0b5;
  --accent:#64e6bd; --warn:#ffcf6a; --err:#ff7d7d; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.shell { max-width: 940px; margin: 0 auto; padding: 40px 20px 80px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:22px; margin-bottom:18px; }
.eyebrow { letter-spacing:.16em; font-size:11px; color:var(--muted); text-transform:uppercase; }
h1 { font-size:22px; margin:6px 0 10px; }
h2 { font-size:16px; margin:0 0 12px; }
p, li { color:var(--muted); }
label { display:block; font-size:12px; color:var(--muted); margin-bottom:12px; }
input, select, textarea { width:100%; margin-top:5px; padding:10px 11px; border-radius:9px; border:1px solid var(--line);
  background:#0b0f16; color:var(--ink); font:inherit; font-size:14px; }
input[readonly] { color:var(--muted); background:#0a0d13; }
.grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 16px; }
.wide { grid-column:1 / -1; }
button { font:inherit; font-weight:600; padding:10px 16px; border-radius:9px; border:1px solid var(--line);
  background:var(--accent); color:#06251d; cursor:pointer; }
button.secondary { background:transparent; color:var(--ink); }
button[disabled] { opacity:.5; cursor:not-allowed; }
.actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:6px; }
.status { margin-top:14px; font-size:14px; white-space:pre-wrap; }
.status.error { color:var(--err); }
.status.ok { color:var(--accent); }
.warn { color:var(--warn); }
table { width:100%; border-collapse:collapse; font-size:13px; }
th, td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:600; }
code { background:#0b0f16; padding:2px 6px; border-radius:6px; font-size:12px; }
a { color:var(--accent); }
.hidden { display:none !important; }
.pill { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; border:1px solid var(--line); }
.pill.ACTIVE { color:var(--accent); border-color:var(--accent); }
.pill.PAUSED, .pill.VALIDATED { color:var(--warn); border-color:var(--warn); }
.pill.RETIRED { color:var(--muted); }
`;

function layout(title, body, script = '') {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow, noarchive" />
<title>${title}</title>
<style>${STYLE}</style>
</head><body><main class="shell">${body}</main>${script ? `<script type="module">${script}</script>` : ''}</body></html>`;
}

/** Unauthenticated shell. Nothing here describes the protected surface. */
export function loginPage() {
  return layout('My Hood · Operations', `
<section class="card">
  <div class="eyebrow">My Hood</div>
  <h1>Operations sign-in</h1>
  <p>This area is restricted. Sign in to continue.</p>
  <form id="login-form">
    <label>Password<input id="admin-password" type="password" autocomplete="current-password" required /></label>
    <div class="actions"><button type="submit">Sign in</button></div>
  </form>
  <div id="login-error" class="status error hidden"></div>
</section>`, `
const form = document.getElementById('login-form');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.getElementById('login-error');
  error.classList.add('hidden');
  const response = await fetch('/api/admin-session', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: document.getElementById('admin-password').value }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { error.textContent = payload.error || 'Access denied'; error.classList.remove('hidden'); return; }
  location.reload();
});`);
}

/** Authenticated console. `environment` is resolved by the deployment (§17). */
export function consolePage(environment) {
  const env = JSON.stringify(environment);
  return layout('My Hood · Token operations', `
<section class="card">
  <div class="eyebrow">My Hood</div>
  <h1>Robinhood Chain token operations</h1>
  <p>Deployment environment <b id="env-name"></b> · chain id <b id="env-chain"></b> · explorer
     <a id="env-explorer" target="_blank" rel="noreferrer noopener">Blockscout</a></p>
  <p>The chain is fixed by this deployment. Development and Preview use Robinhood Chain Testnet 46630; Production uses mainnet 4663.</p>
  <div class="actions"><button id="logout" class="secondary">Lock page</button>
    <button id="refresh" class="secondary">Refresh</button></div>
</section>

<section class="card">
  <h2>Site visibility (kill switch)</h2>
  <p>Turn the entire game into a black screen for every visitor. Use this to
     take the site down instantly. It applies to everyone within a few seconds
     and survives reloads until you turn it back on.</p>
  <p>Current state: <span id="blackout-pill" class="pill">…</span></p>
  <div class="actions">
    <button id="blackout-on">Hide site (black screen)</button>
    <button id="blackout-off" class="secondary">Show site</button>
  </div>
  <div id="blackout-status" class="status"></div>
</section>

<section class="card">
  <h2>1 · Add a token</h2>
  <p>Enter only the token contract address. The software reads its name, symbol,
     decimals and total supply from the chain automatically, and uses the
     deployment's configured deposit vault. Then activate it in step 2.</p>
  <form id="validate-form" class="grid">
    <label class="wide">Token contract address (0x…)
      <input id="contractAddress" required placeholder="0x…" autocomplete="off" spellcheck="false" /></label>
    <div class="actions wide"><button type="submit">Read token &amp; validate</button></div>
  </form>
  <div id="validate-status" class="status"></div>
  <div id="validate-result" class="hidden"></div>
</section>

<section class="card">
  <h2>2 · Activate a validated configuration</h2>
  <p>Activation is a second, deliberate step. Type the confirmation phrase shown next to the configuration exactly.</p>
  <form id="activate-form" class="grid">
    <label class="wide">Configuration id<input id="activateConfigId" placeholder="tcfg_…" autocomplete="off" /></label>
    <label class="wide">Confirmation phrase<input id="confirmationPhrase" placeholder="ACTIVATE SYMBOL CHAINID vN" autocomplete="off" /></label>
    <div class="actions wide"><button type="submit">Activate this configuration</button></div>
  </form>
  <div id="activate-status" class="status"></div>
</section>

<section class="card">
  <h2>Configurations</h2>
  <div id="config-table">Loading…</div>
</section>

<section class="card">
  <h2>Chain health</h2>
  <div id="health">Loading…</div>
</section>

<section class="card">
  <h2>Admin audit log</h2>
  <p>Signatures, keys, session tokens and provider secrets are never recorded.</p>
  <div id="audit">Loading…</div>
</section>`, `
const ENVIRONMENT = ${env};
let csrfToken = null;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

$('env-name').textContent = ENVIRONMENT.networkName + ' (' + ENVIRONMENT.networkType + ')';
$('env-chain').textContent = ENVIRONMENT.chainId;
$('env-explorer').href = ENVIRONMENT.explorerBaseUrl;

async function session() {
  const response = await fetch('/api/admin-session', { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { location.reload(); return false; }
  csrfToken = payload.csrfToken;
  return true;
}

async function call(action, body = {}, method = 'POST') {
  if (method === 'GET') {
    const response = await fetch('/api/token-admin?action=' + encodeURIComponent(action), { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }
  const response = await fetch('/api/token-admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken || '' },
    body: JSON.stringify({ action, csrfToken, ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

function say(id, text, kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = 'status ' + kind;
}

$('logout').addEventListener('click', async () => {
  await fetch('/api/admin-session', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'logout' }),
  });
  location.reload();
});

$('validate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  say('validate-status', 'Reading the contract on ' + ENVIRONMENT.networkName + '…');
  $('validate-result').classList.add('hidden');
  const input = {
    contractAddress: $('contractAddress').value,
  };
  try {
    const result = await call('validate', { input });
    say('validate-status', 'Validated as version ' + result.configVersion + '. Review before activating.', 'ok');
    $('validate-result').classList.remove('hidden');
    $('validate-result').innerHTML =
      '<table><tbody>' +
      '<tr><th>Configuration id</th><td><code>' + esc(result.tokenConfigId) + '</code></td></tr>' +
      '<tr><th>Name</th><td>' + esc(result.name) + '</td></tr>' +
      '<tr><th>Symbol</th><td>' + esc(result.symbol) + '</td></tr>' +
      '<tr><th>Decimals</th><td>' + esc(result.decimals) + '</td></tr>' +
      '<tr><th>Total supply</th><td>' + esc(result.totalSupplyDisplay) + '</td></tr>' +
      '<tr><th>Chain id</th><td>' + esc(result.chainId) + '</td></tr>' +
      '<tr><th>Token explorer</th><td><a target="_blank" rel="noreferrer noopener" href="' + esc(result.explorerUrl) + '">' + esc(result.explorerUrl) + '</a></td></tr>' +
      '<tr><th>Vault explorer</th><td><a target="_blank" rel="noreferrer noopener" href="' + esc(result.vaultExplorerUrl) + '">' + esc(result.vaultExplorerUrl) + '</a></td></tr>' +
      '<tr><th>Vault supports token</th><td>' + esc(String(result.vault.supportedToken)) + '</td></tr>' +
      '<tr><th>Vault paused</th><td>' + esc(String(result.vault.paused)) + '</td></tr>' +
      '<tr><th>Confirmation phrase</th><td><code>' + esc(result.confirmationPhrase) + '</code></td></tr>' +
      '</tbody></table>' +
      (result.warnings.length
        ? '<p class="warn"><b>Warnings:</b><br>' + result.warnings.map(esc).join('<br>') + '</p>'
        : '<p>No warnings.</p>');
    $('activateConfigId').value = result.tokenConfigId;
    $('confirmationPhrase').value = '';
    await loadConfigs();
  } catch (error) {
    say('validate-status', error.message, 'error');
  }
});

$('activate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  say('activate-status', 'Activating…');
  try {
    const result = await call('activate', {
      tokenConfigId: $('activateConfigId').value.trim(),
      confirmationPhrase: $('confirmationPhrase').value,
    });
    say('activate-status', 'Active: ' + result.active.tokenSymbol + ' v' + result.active.configVersion
      + (result.pausedPrevious ? ' · previous configuration paused' : ''), 'ok');
    await loadConfigs();
  } catch (error) {
    say('activate-status', error.message, 'error');
  }
});

async function loadConfigs() {
  try {
    const { configs } = await call('list', {}, 'GET');
    if (!configs.length) { $('config-table').textContent = 'No token configuration has been validated yet.'; return; }
    $('config-table').innerHTML = '<table><thead><tr><th>Version</th><th>Status</th><th>Symbol</th>'
      + '<th>Contract</th><th>Confirmation phrase</th><th></th></tr></thead><tbody>'
      + configs.map((config) =>
        '<tr><td>v' + esc(config.configVersion) + '</td>'
        + '<td><span class="pill ' + esc(config.status) + '">' + esc(config.status) + '</span></td>'
        + '<td>' + esc(config.symbol) + ' · ' + esc(config.decimals) + 'd</td>'
        + '<td><code>' + esc(config.contractAddress) + '</code></td>'
        + '<td><code>' + esc(config.confirmationPhrase) + '</code></td>'
        + '<td>' + (config.status === 'ACTIVE' ? '<button class="secondary" data-status="PAUSED" data-id="' + esc(config.tokenConfigId) + '">Pause</button>' : '')
        + (config.status === 'PAUSED' ? '<button class="secondary" data-status="ACTIVE" data-id="' + esc(config.tokenConfigId) + '">Resume</button>' : '')
        + (['PAUSED', 'VALIDATED', 'DRAFT'].includes(config.status) ? ' <button class="secondary" data-status="RETIRED" data-id="' + esc(config.tokenConfigId) + '">Retire</button>' : '')
        + '</td></tr>').join('')
      + '</tbody></table>';
    $('config-table').querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await call('status', { tokenConfigId: button.dataset.id, status: button.dataset.status }); await loadConfigs(); }
        catch (error) { say('activate-status', error.message, 'error'); button.disabled = false; }
      });
    });
  } catch (error) {
    $('config-table').innerHTML = '<span class="status error">' + esc(error.message) + '</span>';
  }
}

async function loadHealth() {
  try {
    const { health } = await call('health', {}, 'GET');
    $('health').innerHTML = '<table><tbody>'
      + '<tr><th>RPC latency</th><td>' + esc(health.rpcLatencyMs) + ' ms' + (health.rpcError ? ' · <span class="warn">' + esc(health.rpcError) + '</span>' : '') + '</td></tr>'
      + '<tr><th>Provider</th><td>' + (health.usingPublicRpc ? '<span class="warn">public rate-limited RPC</span>' : 'configured provider endpoint') + '</td></tr>'
      + '<tr><th>Latest / safe / finalized</th><td>' + esc(health.heads?.latestBlockNumber) + ' / ' + esc(health.heads?.safeBlockNumber) + ' / ' + esc(health.heads?.finalizedBlockNumber) + '</td></tr>'
      + '<tr><th>Active token</th><td>' + (health.activeTokenConfig ? esc(health.activeTokenConfig.tokenSymbol) + ' v' + esc(health.activeTokenConfig.configVersion) : 'none') + '</td></tr>'
      + '<tr><th>Vault token balance</th><td>' + esc(health.vaultTokenBalance ?? 'unknown') + '</td></tr>'
      + '<tr><th>Withdrawal signer</th><td>' + (health.signer ? (health.signer.error ? '<span class="warn">' + esc(health.signer.error) + '</span>' : esc(health.signer.address) + ' · ' + esc(health.signer.eth) + ' ETH') : 'not configured') + '</td></tr>'
      + '</tbody></table>';
  } catch (error) {
    $('health').innerHTML = '<span class="status error">' + esc(error.message) + '</span>';
  }
}

async function loadAudit() {
  try {
    const { entries } = await call('audit', {}, 'GET');
    $('audit').innerHTML = entries.length
      ? '<table><thead><tr><th>Time</th><th>Action</th><th>Result</th><th>Detail</th></tr></thead><tbody>'
        + entries.map((entry) => '<tr><td>' + esc(new Date(entry.serverTimestamp).toISOString()) + '</td>'
          + '<td>' + esc(entry.action) + '</td><td>' + esc(entry.result) + '</td>'
          + '<td>' + esc(entry.failureReason || JSON.stringify(entry.newConfiguration || {})) + '</td></tr>').join('')
        + '</tbody></table>'
      : 'No admin actions recorded yet.';
  } catch (error) {
    $('audit').innerHTML = '<span class="status error">' + esc(error.message) + '</span>';
  }
}

async function loadBlackout() {
  try {
    const { blackout } = await call('blackout-get', {}, 'GET');
    const pill = $('blackout-pill');
    pill.textContent = blackout ? 'SITE HIDDEN' : 'SITE VISIBLE';
    pill.className = 'pill ' + (blackout ? 'PAUSED' : 'ACTIVE');
    $('blackout-on').disabled = blackout;
    $('blackout-off').disabled = !blackout;
  } catch (error) {
    say('blackout-status', error.message, 'error');
  }
}

async function setBlackout(enabled) {
  say('blackout-status', enabled ? 'Hiding the site for everyone…' : 'Restoring the site…');
  try {
    await call('blackout-set', { enabled });
    say('blackout-status', enabled ? 'The site is now a black screen for every visitor.' : 'The site is visible again.', 'ok');
    await loadBlackout();
  } catch (error) {
    say('blackout-status', error.message, 'error');
  }
}

$('blackout-on').addEventListener('click', () => setBlackout(true));
$('blackout-off').addEventListener('click', () => setBlackout(false));

async function refreshAll() { await Promise.all([loadConfigs(), loadHealth(), loadAudit(), loadBlackout()]); }
$('refresh').addEventListener('click', refreshAll);
if (await session()) await refreshAll();
`);
}
