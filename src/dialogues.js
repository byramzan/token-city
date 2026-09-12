// NPC dialogue data + speech-bubble engine (task3 §13–17).
// Rules: 2–3 lines per conversation, ≤42 chars per line, max 2 concurrent
// conversations, 12–25 s between starts, 10-minute repeat cooldown, bubbles
// attach to the resident (never to an item origin).

import * as THREE from 'three';

// tags: generic | morning | night | shop | tech | reserve | connected | pop | rug
export const DIALOGUES = [
  // GM, GN, daily life
  { id: 1, tags: ['morning'], lines: ['GM. Any alpha?', 'Yeah. Go back to sleep.'] },
  { id: 2, tags: ['morning'], lines: ['GM.', 'It’s 4 p.m.', 'Trenches time is different.'] },
  { id: 3, tags: ['morning'], lines: ['Did you sleep?', 'I closed one eye.', 'Bullish.'] },
  { id: 4, tags: ['night'], lines: ['GN, everyone.', 'The market just opened.', 'Exactly.'] },
  { id: 5, tags: ['generic'], lines: ['Touch grass.', 'Is there a chart for it?'] },
  { id: 6, tags: ['generic'], lines: ['Nice lawn.', 'It’s my offline portfolio.'] },
  // dips, bags
  { id: 7, tags: ['generic'], lines: ['I bought the dip.', 'Which one?', 'All seven.'] },
  { id: 8, tags: ['generic'], lines: ['How heavy are your bags?', 'They’re part of the furniture.'] },
  { id: 9, tags: ['generic'], lines: ['You still holding?', 'The chair won’t let me leave.'] },
  { id: 10, tags: ['generic'], lines: ['Diamond hands?', 'No. Frozen app.'] },
  { id: 11, tags: ['generic'], lines: ['I sold the bottom.', 'Again?', 'Consistency matters.'] },
  { id: 12, tags: ['generic'], lines: ['We’re so back.', 'Back to what?'] },
  { id: 13, tags: ['generic'], lines: ['This dip is healthy.', 'It needs medical attention.'] },
  { id: 14, tags: ['generic'], lines: ['I’m a long-term holder.', 'You bought twelve minutes ago.'] },
  { id: 15, tags: ['generic'], lines: ['How’s the portfolio?', 'Now it’s modern art.'] },
  { id: 16, tags: ['night'], lines: ['One SOL and a dream.', 'Now just the dream.'] },
  // dev, CTO, community
  { id: 17, tags: ['generic'], lines: ['Where’s the dev?', 'Last seen near ATH.'] },
  { id: 18, tags: ['tech'], lines: ['Dev is cooking.', 'Why is the server smoking?'] },
  { id: 19, tags: ['generic'], lines: ['Based dev.', 'He fixed the front door.'] },
  { id: 20, tags: ['generic'], lines: ['Any project updates?', 'New banner.', 'Massive.'] },
  { id: 21, tags: ['generic'], lines: ['Community takeover?', 'Someone has to pay the Wi-Fi.'] },
  { id: 22, tags: ['generic'], lines: ['Strong community.', 'Three people. Twelve wallets.'] },
  { id: 23, tags: ['generic'], lines: ['Who runs this place?', 'The group chat.'] },
  { id: 24, tags: ['generic'], lines: ['The dev renounced control.', 'Of the thermostat?'] },
  { id: 25, tags: ['tech'], lines: ['Utility soon.', 'The door already opens.'] },
  { id: 26, tags: ['night'], lines: ['Roadmap?', 'Kitchen, hallway, moon.'] },
  // narrative & CT
  { id: 27, tags: ['generic'], lines: ['What’s the narrative?', 'Oil. Don’t ask why.'] },
  { id: 28, tags: ['generic'], lines: ['Ticker is the narrative.', 'The ticker is unreadable.'] },
  { id: 29, tags: ['tech'], lines: ['I found alpha.', 'That’s a sponsored post.'] },
  { id: 30, tags: ['generic'], lines: ['IYKYK.', 'I don’t.', 'Neither do I.'] },
  { id: 31, tags: ['generic'], lines: ['Organic growth.', 'That plant is plastic.'] },
  { id: 32, tags: ['generic'], lines: ['Cabal is buying.', 'That’s your second wallet.'] },
  { id: 33, tags: ['tech'], lines: ['Smart money entered.', 'It forgot its keys.'] },
  { id: 34, tags: ['generic'], lines: ['Narrative rotation.', 'The couch hasn’t moved.'] },
  { id: 35, tags: ['generic'], lines: ['This can 100x.', 'The lamp?', 'Especially the lamp.'] },
  { id: 36, tags: ['generic'], lines: ['Any conviction?', 'Two coffees worth.'] },
  // rugs, liquidity, charts
  { id: 37, tags: ['rug'], lines: ['We survived the rug.', 'Why is the floor missing?'] },
  { id: 38, tags: ['rug'], lines: ['Liquidity is locked.', 'Then who has the key?'] },
  { id: 39, tags: ['generic'], lines: ['No FUD.', 'Sir, the roof is on fire.'] },
  { id: 40, tags: ['generic'], lines: ['Are we exit liquidity?', 'We do have matching shirts.'] },
  { id: 41, tags: ['generic'], lines: ['Support is holding.', 'That’s a bookshelf.'] },
  { id: 42, tags: ['generic'], lines: ['Resistance broke.', 'Please stop leaning on it.'] },
  { id: 43, tags: ['generic'], lines: ['Whale incoming.', 'That’s a bath toy.'] },
  { id: 44, tags: ['generic'], lines: ['Market is healing.', 'The toaster stopped smoking.'] },
  { id: 45, tags: ['tech'], lines: ['Send it.', 'To which wallet?'] },
  { id: 46, tags: ['generic'], lines: ['I faded it.', 'It went up?', 'Naturally.'] },
  // shops & public buildings
  { id: 47, tags: ['shop'], lines: ['Is this financial advice?', 'This is a bakery.'] },
  { id: 48, tags: ['shop', 'night'], lines: ['Wen moon?', 'After closing time.'] },
  { id: 49, tags: ['shop'], lines: ['Do you accept copium?', 'Cash only.'] },
  { id: 50, tags: ['shop'], lines: ['What’s today’s special?', 'Exit liquidity.', 'I’ll have water.'] },
  { id: 51, tags: ['shop'], lines: ['Is the coffee bullish?', 'It’s up only.'] },
  { id: 52, tags: ['shop'], lines: ['Why is the café packed?', 'Free Wi-Fi. No alpha.'] },
  { id: 53, tags: ['shop'], lines: ['Rare item?', 'Same chair, gold label.'] },
  { id: 54, tags: ['shop'], lines: ['Can I return this bag?', 'You bought conviction.'] },
  // Meme Reserve Week
  { id: 55, tags: ['reserve'], lines: ['Is this fund official?', 'It has a stamp.'] },
  { id: 56, tags: ['reserve'], lines: ['What does SAOF mean?', 'Depends who launched it.'] },
  { id: 57, tags: ['reserve'], lines: ['Strategic reserve secured.', 'That’s one coin.', 'Strategically.'] },
  { id: 58, tags: ['reserve'], lines: ['Is the oil tokenized?', 'The barrel has Wi-Fi.'] },
  { id: 59, tags: ['reserve'], lines: ['Global asset plan?', 'Step one: make a logo.'] },
  { id: 60, tags: ['reserve'], lines: ['Which one is official?', 'The one saying “official.”'] },
  { id: 61, tags: ['reserve'], lines: ['That’s the third official one.', 'This one has more capitals.'] },
  { id: 62, tags: ['reserve'], lines: ['What backs the fund?', 'A very confident font.'] },
  // connected houses
  { id: 63, tags: ['connected'], lines: ['Why are our houses linked?', 'Same roof. Same mistakes.'] },
  { id: 64, tags: ['connected'], lines: ['Architectural connection.', 'We bought the same window.'] },
  { id: 65, tags: ['connected'], lines: ['Our residents keep visiting.', 'Your café has outlets.'] },
  { id: 66, tags: ['connected'], lines: ['Strong social link.', 'He borrowed my charger.'] },
  { id: 67, tags: ['connected'], lines: ['We’re in the same district.', 'That explains the group chat.'] },
  { id: 68, tags: ['connected'], lines: ['Five active connections.', 'More than my wallet.'] },
  // pop culture (rare)
  { id: 69, tags: ['pop'], lines: ['Is that a portal?', 'It leads to storage.'] },
  { id: 70, tags: ['pop'], lines: ['Final boss?', 'Red candle. Third floor.'] },
  { id: 71, tags: ['pop'], lines: ['What’s your power level?', 'Overleveraged.'] },
  { id: 72, tags: ['pop'], lines: ['Open the utility chest.', 'It’s mostly socks.'] },
  { id: 73, tags: ['pop', 'tech'], lines: ['AI made this poster.', 'That explains nothing.'] },
  { id: 74, tags: ['pop', 'tech'], lines: ['Vibe coded?', 'The chair has no back.'] },
  { id: 75, tags: ['pop'], lines: ['2016 is back.', 'Did it bring liquidity?'] },
  { id: 76, tags: ['pop'], lines: ['Main character energy.', 'Background wallet balance.'] },
  // events
  { id: 77, tags: ['newhouse'], lines: ['Fresh build?', 'Still no utility.'] },
  { id: 78, tags: ['newlink'], lines: ['We’re connected now.', 'Please don’t check my bags.'] },
];

const CFG = {
  minGap: 12, maxGap: 25,       // seconds between conversation starts
  maxConcurrent: 2,
  cooldown: 600,                 // same dialogue: 10 minutes
  maxDist: 42,                   // bubbles only near the camera
  lineTime: 2.6, linePause: 0.35,
  pairDist: 3.2,
};

export class Bubbles {
  /**
   * @param container DOM node for bubble divs
   * @param city City instance (camera, phase, plots, houseGroups)
   * @param residents Residents instance (people)
   */
  constructor(container, city, residents) {
    this.container = container;
    this.city = city;
    this.residents = residents;
    this.active = [];            // conversations
    this.lastShown = new Map();  // dialogue id -> time
    this.t = 0;
    this.nextIn = 4;             // первый разговор — быстро, чтобы город ожил
    this.enabled = true;
    this.tone = 'crypto';        // crypto | friendly | minimal (task3 §16)
  }

  /** Event bubble: one line above a specific person (new house / new link). */
  eventLine(person, tag) {
    const dlg = DIALOGUES.find((d) => d.tags.includes(tag));
    if (!dlg || !person) return;
    this._start([person, person], dlg);
  }

  _contextTags(p) {
    const tags = ['generic'];
    const phase = this.city.phase;
    if (phase < 0.14 || phase > 0.96) tags.push('morning');
    if (phase > 0.66) tags.push('night');
    if (p.rec) {
      if (p.state === 'action' && p.arrival?.kind === 'visit') tags.push('connected');
      else if (p.state === 'action') tags.push('shop');
      const m = p.rec.cfg.material;
      if (m === 'tech') tags.push('tech');
      if (m === 'stone') tags.push('reserve');
      if (m === 'brick' || m === 'wood') tags.push('shop');
      // предметы недельной коллекции во дворе/доме включают reserve-шутки
      if (p.rec.hasReserveItems) tags.push('reserve');
    }
    if (Math.random() < 0.08) tags.push('pop'); // редкие поп-культурные реплики
    return tags;
  }

  _pickDialogue(tags) {
    const now = this.t;
    const pool = [];
    for (const d of DIALOGUES) {
      if (d.tags.includes('newhouse') || d.tags.includes('newlink')) continue;
      const last = this.lastShown.get(d.id) || -1e9;
      if (now - last < CFG.cooldown) continue;
      if (this.tone === 'minimal' && d.lines.some((l) => l.length > 30)) continue;
      const special = d.tags.some((t) => t !== 'generic' && tags.includes(t));
      const genericOk = d.tags.includes('generic') && !d.tags.some((t) => ['shop', 'reserve', 'connected', 'pop', 'tech', 'rug'].includes(t));
      if (special) pool.push({ d, w: 3 });
      else if (genericOk) pool.push({ d, w: 1 });
    }
    if (!pool.length) return null;
    let total = pool.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const x of pool) { r -= x.w; if (r <= 0) return x.d; }
    return pool[0].d;
  }

  _findPair() {
    const cam = this.city.controls.target;
    const people = this.residents.people.filter((p) =>
      p.mesh.visible && p.mesh.position.distanceTo(cam) < CFG.maxDist);
    // перемешать и найти двух рядом стоящих
    for (let i = people.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [people[i], people[j]] = [people[j], people[i]];
    }
    for (const a of people) {
      for (const b of people) {
        if (a === b) continue;
        if (this.active.some((c) => c.people.includes(a) || c.people.includes(b))) continue;
        if (a.mesh.position.distanceTo(b.mesh.position) < CFG.pairDist) return [a, b];
      }
    }
    return null;
  }

  _start(pair, dlg) {
    if (this.active.length >= CFG.maxConcurrent) return;
    this.lastShown.set(dlg.id, this.t);
    const conv = { people: pair, dlg, line: 0, lineT: 0, el: null };
    this.active.push(conv);
    this._showLine(conv);
  }

  _showLine(conv) {
    if (conv.el) { conv.el.remove(); conv.el = null; }
    const text = conv.dlg.lines[conv.line];
    if (text == null) return;
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = text;
    this.container.appendChild(el);
    conv.el = el;
    requestAnimationFrame(() => el.classList.add('show'));
  }

  update(dt, visible = true) {
    this.t += dt;
    this.container.style.display = visible && this.enabled ? '' : 'none';
    if (!visible || !this.enabled) return;

    // запуск новых разговоров
    this.nextIn -= dt * (this.tone === 'minimal' ? 0.5 : 1);
    if (this.nextIn <= 0 && this.active.length < CFG.maxConcurrent) {
      const pair = this._findPair();
      if (pair) {
        const tags = [...new Set([...this._contextTags(pair[0]), ...this._contextTags(pair[1])])];
        const dlg = this._pickDialogue(tags);
        if (dlg) this._start(pair, dlg);
      }
      this.nextIn = CFG.minGap + Math.random() * (CFG.maxGap - CFG.minGap);
    }

    // жизненный цикл реплик + позиционирование
    const w = innerWidth, h = innerHeight;
    const v = new THREE.Vector3();
    for (const conv of [...this.active]) {
      conv.lineT += dt;
      if (conv.lineT > CFG.lineTime + CFG.linePause) {
        conv.line++;
        conv.lineT = 0;
        if (conv.line >= conv.dlg.lines.length) {
          conv.el?.remove();
          this.active.splice(this.active.indexOf(conv), 1);
          continue;
        }
        this._showLine(conv);
      }
      const speaker = conv.people[conv.line % conv.people.length];
      if (!conv.el) continue;
      if (!speaker.mesh.visible) { conv.el.style.opacity = '0'; continue; }
      v.copy(speaker.mesh.position);
      v.y += 1.75; // якорь над головой NPC
      v.project(this.city.camera);
      const behind = v.z > 1 || v.z < -1;
      const dist = speaker.mesh.position.distanceTo(this.city.controls.target);
      if (behind || dist > CFG.maxDist) {
        conv.el.style.opacity = '0';
        continue;
      }
      conv.el.style.opacity = '';
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      conv.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      conv.el.classList.toggle('fade-far', dist > CFG.maxDist * 0.75);
    }
  }

  clear() {
    for (const c of this.active) c.el?.remove();
    this.active = [];
  }
}
