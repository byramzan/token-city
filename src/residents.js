// Residents are visual participants in one household. Family needs, purchases,
// product use and services are authoritative server operations, never frame-driven.

import * as THREE from 'three';
import { mat } from './house.js';
import { PLAZA_R } from './city.js';
import { NEEDS, NEED_BUY_THRESHOLD, BUSINESS_TYPES, residentsFor } from './config.js';
import { state } from './state.js';

const BODY_COLORS = ['#ff8a71', '#4ecdc4', '#ffd166', '#7aa2f7', '#c792ea', '#94d82d', '#f4a4c0'];
const SKIN = ['#f5cfa8', '#e0ac7e', '#c68955', '#8d5a3a'];

export function makePerson(seedIdx = 0) {
  const g = new THREE.Group();
  const bodyColor = BODY_COLORS[seedIdx % BODY_COLORS.length];
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.3), mat(bodyColor));
  body.position.y = 0.62;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 6), mat(SKIN[seedIdx % SKIN.length]));
  head.position.y = 1.13;
  head.castShadow = true;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.34, 0.16), mat('#4c5566'));
  legL.position.set(-0.11, 0.17, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.44, 0.13), mat(bodyColor));
  armL.geometry.translate(0, -0.18, 0);
  armL.position.set(-0.28, 0.9, 0);
  const armR = armL.clone();
  armR.position.x = 0.28;
  g.add(body, head, legL, legR, armL, armR);
  g.userData.legs = [legL, legR];
  g.userData.arms = [armL, armR];
  if (seedIdx % 3 === 1) {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.24, 6), mat(BODY_COLORS[(seedIdx + 3) % BODY_COLORS.length]));
    hat.position.y = 1.34;
    g.add(hat);
  }
  return g;
}

export function needsOf(houseId) {
  if (!state.needs[houseId]) {
    state.needs[houseId] = { hunger: 100, energy: 100, knowledge: 100, bond: 100 };
  }
  return state.needs[houseId];
}

export function restoreNeed(houseId, need, amount) {
  const values = needsOf(houseId);
  if (values.serverAuthoritative) return values[need] || 0;
  if (!(need in values) || !Number.isFinite(amount)) return 0;
  values[need] = Math.max(0, Math.min(100, values[need] + amount));
  return values[need];
}

export function houseInCrisis(houseId) {
  const values = needsOf(houseId);
  return Boolean(values.activeCrisisNeed) || Object.keys(NEEDS).some((key) => values[key] <= 0);
}

export class Residents {
  constructor(scene, city, { linksFor = () => [], onVisit = () => {}, onTrade = () => {} } = {}) {
    this.scene = scene;
    this.city = city;
    this.linksFor = linksFor;
    this.onVisit = onVisit;
    this.onTrade = onTrade; // (order, businessHouseId) — UI feedback
    this.people = [];
    this.t = 0;
    this.needsTimer = 0;
  }

  addForHouse(rec, count = residentsFor(rec.cfg)) {
    const existing = this.people.filter((p) => p.houseId === rec.cfg.id);
    existing.forEach((p) => { p.rec = rec; });
    if (existing.length > count) {
      const excess = new Set(existing.slice(count));
      for (const p of excess) this.scene.remove(p.mesh);
      this.people = this.people.filter((p) => !excess.has(p));
    }
    for (let i = Math.min(existing.length, count); i < count; i++) {
      const p = makePerson(i + rec.cfg.id.length);
      p.position.copy(rec.door);
      p.visible = false;
      this.scene.add(p);
      this.people.push({
        mesh: p,
        houseId: rec.cfg.id,
        rec,
        state: 'inside',
        pauseT: 1 + Math.random() * 7,
        speed: 1.0 + Math.random() * 0.6,
        waypoints: [],
        wpIdx: 0,
        arrival: null,
        phase: Math.random() * 10,
      });
    }
  }

  addCitizens(count = 6) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * (PLAZA_R - 3);
      const p = makePerson(Math.floor(Math.random() * 12));
      p.position.set(Math.cos(a) * r, 0.5, Math.sin(a) * r);
      this.scene.add(p);
      this.people.push({
        mesh: p, state: 'pause', pauseT: Math.random() * 3,
        speed: 0.8 + Math.random() * 0.5, waypoints: [], wpIdx: 0,
        plazaOnly: true, phase: Math.random() * 10,
      });
    }
  }

  removeForHouse(houseId) {
    this.people = this.people.filter((p) => {
      if (p.houseId === houseId) { this.scene.remove(p.mesh); return false; }
      return true;
    });
  }

  _plotOf(rec) { return this.city.plots[rec.cfg.plot.i]; }

  // ── demand & trade loop (task4 §23) ────────────────────────────────────────
  _lowestNeed(houseId) {
    const n = needsOf(houseId);
    let low = null;
    for (const key of Object.keys(NEEDS)) {
      if (!low || n[key] < n[low]) low = key;
    }
    return { key: low, value: n[low] };
  }

  /** Find the best open business fulfilling `need` (stock, price, distance). */
  _findShop(buyerHouse, need) {
    const buyerAcc = buyerHouse.owner;
    let best = null, bestScore = -1e9;
    for (const h of state.houses) {
      const biz = state.businesses[h.id];
      if (!biz || biz.status !== 'open') continue;
      if (h.owner === buyerAcc) continue; // all linked wallets = same account (§20.4)
      const type = BUSINESS_TYPES[biz.type];
      if (!type) continue;
      const rec = this.city.houseGroups.get(h.id);
      if (!rec || !rec.compSpot) continue;
      for (const prod of type.products) {
        if (prod.need !== need) continue;
        if ((biz.stock[prod.id] || 0) <= 0) continue;
        const price = biz.prices?.[prod.id] ?? prod.price;
        const d = Math.hypot(rec.compSpot.x - (this.city.houseGroups.get(buyerHouse.id)?.door.x || 0),
          rec.compSpot.z - (this.city.houseGroups.get(buyerHouse.id)?.door.z || 0));
        const score = (biz.reputation || 0) * 0.4 - price * 0.6 - d * 0.05 + prod.restore * 0.3;
        if (score > bestScore) { bestScore = score; best = { houseId: h.id, biz, prod, price, rec }; }
      }
    }
    return best;
  }

  /** A visual visit only. The player explicitly confirms all recovery purchases. */
  _tryShopping(p) {
    const house = state.houses.find((h) => h.id === p.houseId);
    if (!house || house.owner !== state.account?.id) return false;
    const low = this._lowestNeed(p.houseId);
    if (low.value > NEED_BUY_THRESHOLD) return false;
    const shop = this._findShop(house, low.key);
    if (!shop) return false;
    const from = this._plotOf(p.rec), to = this._plotOf(shop.rec);
    p.waypoints = [p.rec.street.clone(), ...this.city.route(from, to),
      shop.rec.street.clone(), shop.rec.compSpot.clone()];
    p.wpIdx = 0;
    p.arrival = { kind: 'visit', to: shop.houseId, t: 5 };
    p.state = 'walk';
    p.mesh.visible = true;
    return true;
  }

  /** Decide the next trip once a pause ends. */
  _plan(p) {
    if (p.plazaOnly) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * (PLAZA_R - 4);
      p.waypoints = [new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)];
      p.wpIdx = 0;
      p.arrival = { kind: 'pause', t: 1.5 + Math.random() * 5 };
      p.state = 'walk';
      return;
    }
    const night = this.city.nightAmt > 0.6;
    const rec = p.rec;
    const atHome = p.state === 'inside';

    if (night && !atHome) {
      p.waypoints = [rec.door.clone()];
      p.wpIdx = 0;
      p.arrival = { kind: 'home' };
      p.state = 'walk';
      p.mesh.visible = true;
      return;
    }
    if (night && atHome) {
      // Sleeping is visual; only completed recovery actions change family needs.
      p.pauseT = 3 + Math.random() * 5;
      return;
    }

    if (atHome) {
      p.mesh.visible = true;
      p.mesh.position.copy(rec.door);
    }

    // needs first: shopping trip or free service
    if (this._tryShopping(p)) return;

    const roll = Math.random();
    if (roll < 0.4 && rec.compSpot) {
      p.waypoints = [rec.compSpot.clone().add(rndOff(0.9))];
      p.arrival = { kind: 'action', t: 3 + Math.random() * 6 };
    } else if (roll < 0.65) {
      const links = this.linksFor(p.houseId);
      const target = links.length ? this.city.houseGroups.get(links[Math.floor(Math.random() * links.length)].to) : null;
      if (target) {
        const a = this._plotOf(rec), b = this._plotOf(target);
        const street = this.city.route(a, b);
        const spot = (target.compSpot || target.door).clone().add(rndOff(1.1));
        p.waypoints = [rec.street.clone(), ...street, target.street.clone(), spot];
        p.arrival = { kind: 'visit', to: target.cfg.id, t: 3 + Math.random() * 5 };
      } else {
        p.waypoints = [rec.compSpot ? rec.compSpot.clone().add(rndOff(1)) : rec.door.clone()];
        p.arrival = { kind: 'action', t: 3 + Math.random() * 4 };
      }
    } else if (roll < 0.85) {
      const street = this.city.routeToPlaza(this._plotOf(rec));
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * (PLAZA_R - 4);
      p.waypoints = [rec.street.clone(), ...street, new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)];
      p.arrival = { kind: 'pause', t: 3 + Math.random() * 6 };
    } else {
      p.waypoints = [rec.door.clone()];
      p.arrival = { kind: 'home' };
    }
    p.wpIdx = 0;
    p.state = 'walk';
  }

  update(dt) {
    this.t += dt;
    for (const p of this.people) {
      const m = p.mesh;
      if (p.state === 'inside') {
        p.pauseT -= dt;
        if (p.pauseT <= 0) this._plan(p);
        continue;
      }
      const gy = groundY(m.position.x, m.position.z);
      if (p.state === 'pause' || p.state === 'action') {
        p.pauseT -= dt;
        m.position.y = gy + Math.sin(this.t * 2 + p.phase) * 0.02;
        if (p.state === 'action') m.rotation.y += Math.sin(this.t * 1.2 + p.phase) * 0.003;
        if (p.pauseT <= 0) this._plan(p);
        continue;
      }
      const target = p.waypoints[p.wpIdx];
      if (!target) { p.state = 'pause'; p.pauseT = 1; continue; }
      const to = target.clone().sub(m.position);
      to.y = 0;
      const dist = to.length();
      if (dist < 0.45) {
        p.wpIdx++;
        if (p.wpIdx >= p.waypoints.length) {
          const a = p.arrival || { kind: 'pause', t: 2 };
          for (const l of m.userData.legs) l.rotation.x = 0;
          for (const ar of m.userData.arms) ar.rotation.x = 0;
          if (a.kind === 'home') {
            p.state = 'inside';
            p.pauseT = 4 + Math.random() * 10;
            m.visible = false;
          } else if (a.kind === 'visit') {
            p.state = 'action';
            p.pauseT = a.t;
            this.onVisit(p.houseId, a.to);
          } else {
            p.state = a.kind === 'action' ? 'action' : 'pause';
            p.pauseT = a.t;
          }
        }
        continue;
      }
      to.normalize();
      m.position.add(to.multiplyScalar(p.speed * dt));
      const targetAngle = Math.atan2(to.x, to.z);
      m.rotation.y += shortestAngle(m.rotation.y, targetAngle) * Math.min(1, dt * 6);
      const step = this.t * 9 * p.speed + p.phase;
      m.position.y = gy + Math.abs(Math.sin(step)) * 0.07;
      m.userData.legs[0].rotation.x = Math.sin(step) * 0.7;
      m.userData.legs[1].rotation.x = -Math.sin(step) * 0.7;
      m.userData.arms[0].rotation.x = -Math.sin(step) * 0.5;
      m.userData.arms[1].rotation.x = Math.sin(step) * 0.5;
      m.rotation.z = Math.sin(step) * 0.04;
    }
  }
}

function rndOff(r) {
  return new THREE.Vector3((Math.random() - 0.5) * r, 0, (Math.random() - 0.5) * r);
}

function groundY(x, z) {
  const r = Math.hypot(x, z);
  if (r < PLAZA_R - 0.5) return 0.5;
  if (r < PLAZA_R + 1.5) return 0.5 * (1 - (r - (PLAZA_R - 0.5)) / 2);
  return 0;
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
