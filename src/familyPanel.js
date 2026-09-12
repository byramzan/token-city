import { FAMILY_NEEDS, FAMILY_RULES, NEED_KEYS, needState, recoveryPreview, validateRecovery } from '../server/familyRules.js';

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = (value) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
export function formatNeedTime(value, key, simulationState = 'active') {
  const rate = simulationState === 'background' ? 0.25 : simulationState === 'offline' ? (key === 'familyBond' ? 0 : 0.1) : 1;
  if (!rate) return 'Paused offline';
  const minutes = Math.max(0, Math.ceil(Number(value) / 100 * FAMILY_NEEDS[key].activeHours * 60 / rate));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
export function effectsMarkup(snapshot, product, quote = recoveryPreview(snapshot, product)) {
  return `<div class="recovery-summary"><p><b>Family: ${snapshot.residentCount} people</b> · ${snapshot.familyConsumptionUnits} family unit(s)</p>
    <p>This package covers <b>${product.coveredResidents}</b> residents${quote.partial ? ' · <strong class="recovery-warning">Partial recovery</strong>' : ' · Full coverage'}.</p>
    ${Object.entries(quote.effects || {}).map(([key, effect]) => `<div class="recovery-line"><span>${FAMILY_NEEDS[key]?.icon || ''} ${FAMILY_NEEDS[key]?.name || key}</span><b>${number(snapshot.needs[key])} → ${number(quote.resultingNeeds?.[key])} <small>(+${number(effect)})</small></b></div>`).join('')}
    ${Object.entries(quote.suspendedEffects || {}).map(([key, effect]) => `<p class="recovery-warning">${FAMILY_NEEDS[key].name} +${number(effect)} is suspended during the ${FAMILY_NEEDS[snapshot.activeCrisisNeed]?.name} crisis.</p>`).join('')}
    ${snapshot.activeCrisisNeed ? `<p>${quote.crisisAfter ? `${FAMILY_NEEDS[quote.crisisAfter].name} crisis remains. Recovery must reach 20.` : 'This action resolves the active crisis.'}</p>` : ''}
    <p class="muted">${product.delivery === 'service' ? `The family visit takes ${Math.round(product.durationMs / 1000)} seconds. Recovery applies when you complete the visit.` : `Recovery applies only when you ${product.useLabel?.toLowerCase() || 'use'} this item from Family & supplies.`}</p></div>`;
}

export function createFamilyPanel({ client, getHouse, ensure, openShop, review, onError, emergency, onPlacementLog = () => {} }) {
  const content = document.getElementById('family-content');
  const modal = document.getElementById('modal-family');
  let snapshotTime = performance.now();
  let lastSnapshot;
  let clock;
  function render() {
    const house = getHouse();
    const family = client.state;
    document.getElementById('family-title').textContent = house ? `${house.name} · Family` : 'Your family';
    if (!house) { content.innerHTML = '<p>Build your family house to begin.</p>'; return; }
    if (!family || family.houseId !== house.id) {
      content.innerHTML = '<p>Your family state is private. Unlock it with your connected wallet to view supplies and recovery offers.</p><button class="btn btn-primary" id="family-unlock">Unlock family</button>';
      document.getElementById('family-unlock').onclick = async () => { try { await ensure(); render(); } catch (error) { onError(error.message); } };
      return;
    }
    if (lastSnapshot !== family) { snapshotTime = performance.now(); lastSnapshot = family; }
    const crisis = family.activeCrisisNeed;
    const lowNeeds = NEED_KEYS.filter((key) => family.needs[key] <= 30);
    const recommendedNeeds = crisis ? [crisis] : lowNeeds.length ? lowNeeds : NEED_KEYS;
    content.innerHTML = `<div class="family-facts"><span>${family.floorCount} floor(s)</span><span>${family.residentCount} residents</span><span>${family.familyConsumptionUnits} family unit(s)</span></div>
      ${crisis ? `<div class="family-crisis" role="alert"><b>${family.fullCrisis ? 'Full Household Crisis' : `${FAMILY_NEEDS[crisis].name} crisis`}</b><p>Restore ${FAMILY_NEEDS[crisis].name} to at least 20. Other recovery actions are paused. Your house, business and belongings remain yours.</p><ol class="crisis-sequence">${(family.crisisSequence || [crisis]).map((key, index) => `<li class="${index === 0 ? 'current' : ''}">${FAMILY_NEEDS[key].icon} ${FAMILY_NEEDS[key].name}${index === 0 ? ' · restore now' : ' · next'}</li>`).join('')}</ol></div>` : ''}
      <div class="family-needs">${NEED_KEYS.map((key) => `<div class="family-need ${needState(family.needs[key])}"><div><b>${FAMILY_NEEDS[key].icon} ${FAMILY_NEEDS[key].name}</b><span>${number(family.needs[key])}/100</span></div><div class="need-bar"><div class="need-fill" style="width:${family.needs[key]}%"></div></div><small>${needState(family.needs[key])} · ${formatNeedTime(family.needs[key], key, family.simulationState)} until zero</small></div>`).join('')}</div>
      <h3>Recommended player businesses</h3><div class="family-recommendations">${recommendedNeeds.map((key) => {
        const offers = (family.recommendations?.[key] || []).slice(0, 3);
        return `<section><h4>${FAMILY_NEEDS[key].icon} ${FAMILY_NEEDS[key].name}</h4>${offers.length ? offers.map((offer) => `<button class="family-offer" data-family-shop="${escapeHtml(offer.houseId)}"><span><b>${escapeHtml(offer.houseName)}</b> · ${escapeHtml(offer.name)}</span><small>${number(offer.price)} coins · +${number(offer.recovery)} · covers ${offer.coveredResidents || offer.product?.coveredResidents} · ${number(offer.distance)}m · stock ${offer.stock}</small></button>`).join('') : '<p class="muted">No suitable stocked player offer is available.</p>'}</section>`;
      }).join('')}</div>
      ${family.emergency ? `<div class="family-emergency"><b>City emergency support</b><p>Player offers are unavailable. This paid fallback restores only ${FAMILY_NEEDS[crisis].name} to 20.</p><button class="btn btn-primary" id="family-emergency">Review · ${number(family.emergency.price)} coins</button></div>` : crisis && !(family.recommendations?.[crisis]?.length) ? `<p class="muted">Emergency support becomes available after ${FAMILY_RULES.emergencyGraceMs / 60000} minutes without an eligible player offer.</p>` : ''}
      <h3>Household supplies</h3><div class="storage-totals">${Object.entries(FAMILY_RULES.storage).map(([category, max]) => { const used = (family.inventory || []).filter((item) => !item.usedAt && item.storageCategory === category).reduce((sum, item) => sum + (['books', 'flowers'].includes(category) ? 1 : item.stockUnits), 0); return `<span>${category}: ${used}/${max}</span>`; }).join('')}</div>
      <div class="family-supplies">${(family.inventory || []).filter((item) => !item.usedAt).map((item) => { const reason = validateRecovery({ ...family, readTitles: family.readTitles || [] }, item); return `<div class="supply-row"><div><b>${escapeHtml(item.name)}</b><small>Covers ${item.coveredResidents} · ${reason ? escapeHtml(reason) : 'Ready to use'}</small></div><button class="btn btn-ghost" data-family-use="${escapeHtml(item.id)}" ${reason ? 'disabled' : ''}>${escapeHtml(item.useLabel)}</button></div>`; }).join('') || '<p class="muted">Buy food, drinks, books or flowers from a player business. Use them here when your family needs them.</p>'}</div>
      <h3>Family visits</h3><div class="family-services">${(family.services || []).filter((item) => !item.completedAt).map((item) => `<div class="supply-row"><div><b>${escapeHtml(item.name)}</b><small data-service-status="${escapeHtml(item.id)}">Visit in progress</small></div><button class="btn btn-primary" data-family-complete="${escapeHtml(item.id)}" data-completes-at="${item.completeAt}">Complete visit</button></div>`).join('') || '<p class="muted">No family visit in progress.</p>'}</div>`;
    content.querySelectorAll('[data-family-shop]').forEach((button) => { button.onclick = () => { modal.classList.add('hidden'); openShop(button.dataset.familyShop); }; });
    content.querySelectorAll('[data-family-use]').forEach((button) => { button.onclick = () => {
      const item = family.inventory.find((entry) => entry.id === button.dataset.familyUse);
      review({ title: `${item.useLabel}: ${item.name}`, body: effectsMarkup(family, item), label: item.useLabel,
        onConfirm: async () => { await client.use(item.id); render(); } });
    }; });
    content.querySelectorAll('[data-family-complete]').forEach((button) => { button.onclick = async () => { button.disabled = true; try { await client.complete(button.dataset.familyComplete); render(); } catch (error) { onError(error.message); button.disabled = false; } }; });
    document.getElementById('family-emergency')?.addEventListener('click', () => emergency(family.emergency));
    updateTimers();
  }
  function updateTimers() {
    const family = client.state;
    if (!family || modal.classList.contains('hidden')) return;
    const approximateServerTime = family.serverTime + (performance.now() - snapshotTime);
    content.querySelectorAll('[data-family-complete]').forEach((button) => {
      const left = Math.max(0, Math.ceil((Number(button.dataset.completesAt) - approximateServerTime) / 1000));
      button.disabled = left > 0;
      const label = [...content.querySelectorAll('[data-service-status]')].find((el) => el.dataset.serviceStatus === button.dataset.familyComplete);
      if (label) label.textContent = left > 0 ? `${left}s remaining` : 'Visit finished · ready to complete';
    });
  }
  clock = setInterval(updateTimers, 1000);
  return { render, open() { modal.classList.remove('hidden'); render(); }, stop() { clearInterval(clock); } };
}
