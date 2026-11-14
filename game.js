/* Eightball — classic 8-ball pool. Plain HTML/CSS/JS, no dependencies. */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Table geometry (world units = SVG viewBox units of pool-table.svg)  */
  /* ------------------------------------------------------------------ */
  const WORLD = { x: 60, y: 60, w: 1320, h: 780, cx: 720, cy: 450 };
  const PLAY = { left: 204, right: 1236, top: 192, bottom: 708 };
  const HEAD_X = 462;               // head string / head spot
  const FOOT = { x: 978, y: 450 };  // foot spot (rack apex)
  const R = 15;                     // ball radius

  const POCKETS = [
    { x: 194, y: 182, r: 29, corner: true },
    { x: 1246, y: 182, r: 29, corner: true },
    { x: 194, y: 718, r: 29, corner: true },
    { x: 1246, y: 718, r: 29, corner: true },
    { x: 720, y: 170, r: 26, corner: false },
    { x: 720, y: 730, r: 26, corner: false }
  ];

  // Cushion noses and mitred jaws, taken from the six cushion paths in the SVG.
  const SEGMENTS = [
    [239, 192, 684, 192], [239, 192, 217, 172], [684, 192, 694, 174],
    [756, 192, 1201, 192], [756, 192, 746, 174], [1201, 192, 1223, 172],
    [204, 236, 204, 664], [204, 236, 184, 210], [204, 664, 184, 686],
    [1236, 236, 1236, 664], [1236, 236, 1256, 210], [1236, 664, 1256, 686],
    [239, 708, 684, 708], [239, 708, 217, 728], [684, 708, 694, 726],
    [756, 708, 1201, 708], [756, 708, 746, 726], [1201, 708, 1223, 728]
  ].map(([x1, y1, x2, y2]) => {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    return { x1, y1, x2, y2, dx, dy, len, ux: dx / len, uy: dy / len };
  });

  const COLORS = {
    1: '#f2c530', 2: '#1f4fb3', 3: '#d3312b', 4: '#5b2a86', 5: '#ef7d1a', 6: '#1f7a3a', 7: '#7a1f2b', 8: '#141414',
    9: '#f2c530', 10: '#1f4fb3', 11: '#d3312b', 12: '#5b2a86', 13: '#ef7d1a', 14: '#1f7a3a', 15: '#7a1f2b'
  };
  const RACK = [[1], [9, 2], [10, 8, 3], [11, 7, 14, 4], [5, 13, 15, 6, 12]];

  /* Physics tuning */
  const MAX_SPEED = 2300;      // px/s at 100% power
  const DRAG = 0.55;           // per-second proportional drag
  const ROLL_DECEL = 36;       // px/s² constant deceleration
  const STOP_SPEED = 5;
  const BALL_REST = 0.96;
  const CUSHION_REST = 0.78;
  const CUSHION_TANGENT = 0.94;
  const STEP = 1 / 240;

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const canvas = $('table');
  const ctx = canvas.getContext('2d', { alpha: true });
  const ui = {
    toast: $('toast'), power: $('power-pull'), ppHandle: $('pp-handle'), ppFill: $('pp-fill'), ppVal: $('pp-val'),
    aimStrip: $('aim-strip'), aimTicks: $('aim-ticks'),
    newGame: $('new-game-button'), sound: $('sound-button'), helpDialog: $('help-dialog'), helpClose: $('help-close'), startHelp: $('start-help'),
    startOverlay: $('start-overlay'), endOverlay: $('end-overlay'),
    endTitle: $('end-title'), endReason: $('end-reason'), endStats: $('end-stats'), rematch: $('rematch-button'), changeMode: $('change-mode-button'),
    install: $('install-button'), resume: $('resume-button'), announce: $('announcement'),
    players: [
      { card: $('player-1'), name: $('player-1-name'), group: $('player-1-group'), ball: $('player-1-ball') },
      { card: $('player-2'), name: $('player-2-name'), group: $('player-2-group'), ball: $('player-2-ball') }
    ]
  };

  /* ------------------------------------------------------------------ */
  /* Audio (synthesised, no files)                                       */
  /* ------------------------------------------------------------------ */
  const audio = {
    ctx: null, enabled: localStorage.getItem('eightball.sound') !== 'off', lastClick: 0, noise: null,
    ensure() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        setTimeout(() => this.load(), 0);
        const len = this.ctx.sampleRate * 0.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    burst(freq, q, dur, gain) {
      const c = this.ensure(); if (!c) return;
      const src = c.createBufferSource(); src.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain();
      const t = c.currentTime;
      g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t); src.stop(t + dur + 0.02);
    },
    click(strength) {
      const now = performance.now(); if (now - this.lastClick < 22) return; this.lastClick = now;
      if (this.play('ball', 0.35 + strength * 0.65)) return;
      this.burst(2600 + strength * 900, 1.1, 0.045 + strength * 0.03, Math.min(0.9, 0.08 + strength * 0.7));
    },
    cushion(strength) { if (this.play('cushion', 0.3 + strength)) return; this.burst(420, 1.4, 0.09, Math.min(0.5, 0.05 + strength * 0.35)); },
    pocket() {
      if (this.play('pocket')) return;
      const c = this.ensure(); if (!c) return;
      const o = c.createOscillator(); const g = c.createGain(); const t = c.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(340, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.18);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.25);
      this.burst(900, 0.8, 0.12, 0.18);
    },
    /* Optional mp3 files in sounds/ (first name that exists is used; a missing file keeps the built-in synth sound):
       shot.mp3 cue hits the ball | ball.mp3 ball touches ball | foul.mp3 wrong ball / foul | gameover.mp3 game over
       (optional: cushion.mp3 rail, pocket.mp3 ball drops in) */
    FILES: { shot: ['shot', 'cue'], ball: ['ball', 'click'], foul: ['foul', 'wrong'], gameover: ['gameover', 'win'], cushion: ['cushion', 'rail'], pocket: ['pocket'], tick: ['tick', 'aim'] },
    VOL: { shot: 1, ball: 0.9, foul: 1, gameover: 1, cushion: 0.7, pocket: 0.9, tick: 0.6 },
    buf: {}, loading: false,
    async load() {
      const c = this.ctx; if (this.loading || !c) return; this.loading = true;
      await Promise.all(Object.keys(this.FILES).map(async (key) => {
        for (const name of this.FILES[key]) {
          try { const r = await fetch('sounds/' + name + '.mp3'); if (!r.ok) continue; this.buf[key] = await c.decodeAudioData(await r.arrayBuffer()); return; }
          catch (_) { /* missing / not decodable: try the next name */ }
        }
      }));
    },
    play(key, vol) {
      const b = this.buf[key]; if (!b || !this.enabled) return false;
      const c = this.ensure(); if (!c) return false;
      const src = c.createBufferSource(); src.buffer = b;
      const g = c.createGain(); g.gain.value = Math.min(1, (this.VOL[key] || 1) * (vol === undefined ? 1 : vol));
      src.connect(g).connect(c.destination); src.start(); return true;
    },
    tick() {                                      // one small "tick" per mark the aim line passes
      const now = performance.now(); if (now - (this.lastTick || 0) < 35) return; this.lastTick = now;
      if (this.play('tick')) return;
      const c = this.ensure(); if (!c || !this.enabled) return;
      const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(2600, t); o.frequency.exponentialRampToValueAtTime(1500, t + 0.03);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.04);
    },
    toggle() {
      this.enabled = !this.enabled;
      localStorage.setItem('eightball.sound', this.enabled ? 'on' : 'off');
      if (this.enabled) this.ensure();
    }
  };

  /* ------------------------------------------------------------------ */
  /* Game state                                                          */
  /* ------------------------------------------------------------------ */
  const game = {
    mode: null,                 // 'pvp' | 'cpu'
    state: 'menu',              // menu | aim | striking | rolling | over
    balls: [],
    current: 0,
    groups: [null, null],       // 'solid' | 'stripe' | null (open table)
    ballInHand: false,
    kitchenOnly: false,
    breakShot: true,
    visits: 1,                  // shots the current player still owns (a foul gives the opponent 2)
    aim: Math.PI,               // radians, direction cue ball will travel
    power: 0.55,
    shot: null,                 // bookkeeping for the shot in progress
    strike: null,               // cue strike animation
    stats: [{ shots: 0, potted: 0, fouls: 0 }, { shots: 0, potted: 0, fouls: 0 }],
    aimTarget: null,            // smoothed fine-aim target (radians) or null
    dragging: null,             // 'aim' | 'cue'
    cueValid: true,
    aiTimer: 0,
    aiTween: null,
    winner: null,
    paused: false
  };

  const cueBall = () => game.balls[0];
  const groupLabel = (g) => g === 'solid' ? 'Full' : 'Half';
  const shortName = (i) => game.mode === 'cpu' ? (i === 0 ? 'You' : 'CPU') : `P${i + 1}`;
  const playerName = (i) => game.mode === 'cpu' ? (i === 0 ? 'You' : 'Computer') : `Player ${i + 1}`;
  const isCpuTurn = () => game.mode === 'cpu' && game.current === 1;
  const typeOf = (n) => n === 0 ? 'cue' : n === 8 ? 'eight' : n < 8 ? 'solid' : 'stripe';
  const remaining = (type) => game.balls.filter((b) => b.type === type && b.inPlay && !b.sinking).length;

  function makeBall(n, x, y) {
    const ang = Math.random() * Math.PI * 2, tilt = Math.random() * 0.8 - 0.4;
    return {
      n, type: typeOf(n), color: n === 0 ? '#f4f1e8' : COLORS[n], x, y, vx: 0, vy: 0, inPlay: true, sinking: null,
      // orientation: axis vector `s` (spot / stripe pole) as a unit 3-vector
      s: normalize3(Math.cos(ang), Math.sin(ang), tilt)
    };
  }
  function normalize3(x, y, z) { const l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; }

  function rack() {
    const balls = [makeBall(0, HEAD_X, FOOT.y)];
    const gap = 0.6, dx = (2 * R + gap) * Math.cos(Math.PI / 6), dy = 2 * R + gap;
    RACK.forEach((row, i) => row.forEach((n, j) => {
      const x = FOOT.x + i * dx + (Math.random() - 0.5) * 0.4;
      const y = FOOT.y + (j - i / 2) * dy + (Math.random() - 0.5) * 0.4;
      balls.push(makeBall(n, x, y));
    }));
    return balls;
  }

  function newGame(mode) {
    game.mode = mode || game.mode || 'pvp';
    game.balls = rack();
    game.current = 0;
    game.groups = [null, null];
    game.breakShot = true; game.visits = 1;
    game.ballInHand = true;
    game.kitchenOnly = true;
    game.aim = 0;
    game.shot = null; game.strike = null; game.aiTween = null; game.winner = null;
    game.stats = [{ shots: 0, potted: 0, fouls: 0 }, { shots: 0, potted: 0, fouls: 0 }];
    setState('aim');
    ui.startOverlay.hidden = true;
    ui.endOverlay.hidden = true;
    ui.players[0].name.textContent = shortName(0);
    ui.players[1].name.textContent = shortName(1);
    hudCache.length = 0; game.aimTarget = null; game.power = REST_POWER;
    setStatus('Break', `${playerName(0)} to break`, 'Place the cue ball behind the line, then aim', '');
    updateHud();
    scheduleAi();
  }

  const REST_POWER = 0.1;      // cue rests this far back when the power knob is at the top
  const PULL_MIN = 0.07;       // pulling less than this and letting go cancels the shot

  function setState(s) {
    game.state = s;
    canvas.classList.toggle('busy', s !== 'aim');
    canvas.classList.toggle('placing', s === 'aim' && game.ballInHand && !isCpuTurn());
    if (s === 'aim' && !isCpuTurn()) game.power = REST_POWER;
    sticky = s === 'aim' && game.ballInHand && !isCpuTurn()
      ? (game.kitchenOnly ? 'Ball in hand — drag the cue ball behind the line' : 'Ball in hand — drag the cue ball to place it')
      : s === 'aim' && isCpuTurn() ? 'Computer is thinking…' : '';
    refreshToast();
    refreshControls();
    invalidate();
  }

  function refreshControls() {
    const can = game.state === 'aim' && !isCpuTurn() && !game.paused;
    ui.aimStrip.classList.toggle('disabled', !can);
    ui.power.classList.toggle('disabled', !(can && game.cueValid));
  }

  /* Short messages fade by themselves; a "sticky" hint (ball in hand…) stays until it no longer applies. */
  let sticky = '', toastTimer = 0, toastUntil = 0;
  function paintToast(text, sub, tone) {
    return;   // pop-up messages are switched off
    ui.toast.className = 'toast show' + (tone ? ` ${tone}` : '');
    ui.toast.replaceChildren(document.createTextNode(text));
    if (sub) { const el = document.createElement('small'); el.textContent = sub; ui.toast.appendChild(el); }
  }
  function refreshToast() {
    if (performance.now() < toastUntil) return;
    if (sticky) paintToast(sticky); else ui.toast.classList.remove('show');
  }
  function setStatus(kicker, text, sub, tone) {
    ui.announce.textContent = `${text}. ${sub || ''}`;
    paintToast(text, sub, tone);
    toastUntil = performance.now() + 2800;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastUntil = 0; refreshToast(); }, 2850);
  }

  /* ------------------------------------------------------------------ */
  /* HUD — one ball per player: Full (1-7) or Half (9-15)                */
  /* ------------------------------------------------------------------ */
  const hudCache = [];
  function updateHud() {
    ui.players.forEach((p, i) => {
      const active = game.state !== 'over' && game.state !== 'menu' && game.current === i;
      const g = game.groups[i];
      const left = g ? remaining(g) : -1;
      const nextBall = g ? game.balls.filter((b) => b.type === g && b.inPlay && !b.sinking).reduce((m, b) => (m === 0 || b.n < m ? b.n : m), 0) : 0;
      const key = `${active}|${game.winner === i}|${g}|${left}|${nextBall}`;
      if (hudCache[i] === key) return;
      hudCache[i] = key;
      p.card.classList.toggle('active', active);
      p.card.classList.toggle('winner', game.winner === i);
      if (!g) { p.group.textContent = 'Open'; p.ball.className = 'mini-ball unknown'; p.ball.innerHTML = '<span>?</span>'; return; }
      p.group.textContent = groupLabel(g);
      if (left > 0) { const sm = document.createElement('small'); sm.textContent = `${left} left`; p.group.appendChild(sm); }
      else { const sm = document.createElement('small'); sm.textContent = 'play the 8'; p.group.appendChild(sm); }
      p.ball.className = `mini-ball${g === 'stripe' ? ' stripe' : ''}`;
      p.ball.style.setProperty('--c', COLORS[nextBall || 8] || (g === 'stripe' ? COLORS[10] : COLORS[1]));
      p.ball.innerHTML = `<span>${nextBall || 8}</span>`;     // number of your lowest ball still on the table (8 once your group is cleared)
    });
  }

  /* ------------------------------------------------------------------ */
  /* Geometry helpers                                                    */
  /* ------------------------------------------------------------------ */
  const INNER = { l: PLAY.left + R + 6, r: PLAY.right - R - 6, t: PLAY.top + R + 6, b: PLAY.bottom - R - 6 };
  // Away from the rails no cushion or pocket can be touched, so those tests are skipped (most of the table, most of the time).
  const inInterior = (x, y) => x > INNER.l && x < INNER.r && y > INNER.t && y < INNER.b;
  function closestOnSegment(s, px, py) {
    let t = ((px - s.x1) * s.dx + (py - s.y1) * s.dy) / (s.len * s.len);
    t = Math.max(0, Math.min(1, t));
    return { x: s.x1 + s.dx * t, y: s.y1 + s.dy * t };
  }
  function circleHitsSegment(x, y, r, s) {
    let t = ((x - s.x1) * s.dx + (y - s.y1) * s.dy) / (s.len * s.len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = s.x1 + s.dx * t - x, cy = s.y1 + s.dy * t - y;
    return cx * cx + cy * cy < r * r;
  }
  function overlapsBall(x, y, except) {
    return game.balls.some((b) => b !== except && b.inPlay && !b.sinking && Math.hypot(b.x - x, b.y - y) < 2 * R + 0.5);
  }
  function inPocketZone(x, y) {
    return POCKETS.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + R);
  }
  function legalCuePosition(x, y) {
    if (x < PLAY.left + R || x > PLAY.right - R || y < PLAY.top + R || y > PLAY.bottom - R) return false;
    if (game.kitchenOnly && x > HEAD_X) return false;
    if (SEGMENTS.some((s) => circleHitsSegment(x, y, R, s))) return false;
    if (inPocketZone(x, y)) return false;
    return !overlapsBall(x, y, cueBall());
  }
  function clampCue(x, y) {
    x = Math.max(PLAY.left + R, Math.min(game.kitchenOnly ? HEAD_X : PLAY.right - R, x));
    y = Math.max(PLAY.top + R, Math.min(PLAY.bottom - R, y));
    return { x, y };
  }
  // Ray (moving ball) cast: returns nearest hit along direction (dx,dy) from (x,y)
  function castRay(x, y, dx, dy, ignore) {
    let best = { dist: 1600, kind: null, ball: null };
    for (const b of game.balls) {
      if (b === ignore || !b.inPlay || b.sinking) continue;
      const fx = b.x - x, fy = b.y - y;
      const proj = fx * dx + fy * dy;
      if (proj <= 0) continue;
      const perp2 = fx * fx + fy * fy - proj * proj;
      const rr = (2 * R) * (2 * R);
      if (perp2 > rr) continue;
      const d = proj - Math.sqrt(rr - perp2);
      if (d > 0 && d < best.dist) best = { dist: d, kind: 'ball', ball: b };
    }
    // cushions: march
    for (let d = 0; d < best.dist; d += 4) {
      const px = x + dx * d, py = y + dy * d;
      if (inInterior(px, py)) continue;
      if (SEGMENTS.some((s) => circleHitsSegment(px, py, R, s)) || px < PLAY.left - 30 || px > PLAY.right + 30 || py < PLAY.top - 30 || py > PLAY.bottom + 30) {
        best = { dist: d, kind: 'cushion', ball: null };
        break;
      }
    }
    return best;
  }
  function pathClear(x1, y1, x2, y2, ignoreA, ignoreB) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    for (const b of game.balls) {
      if (b === ignoreA || b === ignoreB || !b.inPlay || b.sinking) continue;
      const fx = b.x - x1, fy = b.y - y1, proj = fx * ux + fy * uy;
      if (proj < -R || proj > len + R) continue;
      const perp = Math.abs(fx * uy - fy * ux);
      if (perp < 2 * R) return false;
    }
    for (let d = 0; d < len; d += 6) {
      if (inInterior(x1 + ux * d, y1 + uy * d)) continue;
      if (SEGMENTS.some((s) => circleHitsSegment(x1 + ux * d, y1 + uy * d, R - 1, s))) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Physics                                                             */
  /* ------------------------------------------------------------------ */
  function rotateAxis(v, ax, ay, az, ang) {
    // Rodrigues rotation of vector v about unit axis a by ang
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const dot = ax * v.x + ay * v.y + az * v.z;
    return {
      x: v.x * c + (ay * v.z - az * v.y) * s + ax * dot * t,
      y: v.y * c + (az * v.x - ax * v.z) * s + ay * dot * t,
      z: v.z * c + (ax * v.y - ay * v.x) * s + az * dot * t
    };
  }

  function stepPhysics(dt) {
    const balls = game.balls;
    // integrate
    for (const b of balls) {
      if (!b.inPlay) continue;
      if (b.sinking) {
        b.sinking.t += dt;
        const k = Math.min(1, b.sinking.t / 0.28);
        b.x += (b.sinking.px - b.x) * Math.min(1, dt * 14);
        b.y += (b.sinking.py - b.y) * Math.min(1, dt * 14);
        b.sinking.scale = 1 - k * 0.55;
        if (k >= 1) { b.inPlay = false; b.sinking = null; }
        continue;
      }
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        // roll the sphere
        const ang = sp * dt / R;
        b.s = rotateAxis(b.s, -b.vy / sp, b.vx / sp, 0, ang);
        let nsp = sp * (1 - DRAG * dt) - ROLL_DECEL * dt;
        if (nsp < STOP_SPEED) nsp = 0;
        const f = nsp / sp; b.vx *= f; b.vy *= f;
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.dirty = true;
      }
    }
    // ball-ball collisions (two relaxation passes)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i]; if (!a.inPlay || a.sinking) continue;
        const am = a.vx !== 0 || a.vy !== 0;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j]; if (!b.inPlay || b.sinking) continue;
          if (!am && b.vx === 0 && b.vy === 0) continue;      // two resting balls can't collide
          const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = 2 * R - d;
          a.x -= nx * overlap / 2; a.y -= ny * overlap / 2; b.x += nx * overlap / 2; b.y += ny * overlap / 2;
          a.dirty = b.dirty = true;
          const rvx = b.vx - a.vx, rvy = b.vy - a.vy, vn = rvx * nx + rvy * ny;
          if (vn >= 0) continue;
          const jimp = -(1 + BALL_REST) * vn / 2;
          a.vx -= jimp * nx; a.vy -= jimp * ny; b.vx += jimp * nx; b.vy += jimp * ny;
          const strength = Math.min(1, -vn / 1600);
          if (pass === 0) {
            audio.click(strength);
            if (game.shot && game.shot.firstContact === null && (a.n === 0 || b.n === 0)) game.shot.firstContact = a.n === 0 ? b : a;
          }
        }
      }
    }
    // cushions & pockets
    for (const b of balls) {
      if (!b.inPlay || b.sinking || inInterior(b.x, b.y)) continue;
      for (const s of SEGMENTS) {
        const c = closestOnSegment(s, b.x, b.y);
        const dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy);
        if (d >= R || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        b.x += nx * (R - d); b.y += ny * (R - d);
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          const vtX = b.vx - vn * nx, vtY = b.vy - vn * ny;
          b.vx = (vtX * CUSHION_TANGENT) - vn * CUSHION_REST * nx;
          b.vy = (vtY * CUSHION_TANGENT) - vn * CUSHION_REST * ny;
          if (-vn > 60) audio.cushion(Math.min(1, -vn / 1500));
          if (game.shot) game.shot.rails++;
        }
      }
      for (const p of POCKETS) {
        if (Math.hypot(p.x - b.x, p.y - b.y) < p.r) { pocketBall(b, p); break; }
      }
      if (!b.sinking && (b.x < PLAY.left - 40 || b.x > PLAY.right + 40 || b.y < PLAY.top - 40 || b.y > PLAY.bottom + 40)) {
        let near = POCKETS[0], nd = Infinity;
        for (const p of POCKETS) { const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < nd) { nd = d; near = p; } }
        pocketBall(b, near);
      }
    }
  }

  function pocketBall(b, p) {
    b.sinking = { px: p.x, py: p.y, t: 0, scale: 1 };
    b.dirty = true;
    b.vx = 0; b.vy = 0;
    audio.pocket();
    if (game.shot) game.shot.pocketed.push(b);
    updateHud();
  }

  const anyMoving = () => game.balls.some((b) => b.inPlay && (b.sinking || Math.abs(b.vx) > 0 || Math.abs(b.vy) > 0));

  /* ------------------------------------------------------------------ */
  /* Shot flow & rules                                                   */
  /* ------------------------------------------------------------------ */
  function shoot() {
    if (game.state !== 'aim' || !game.cueValid) return;
    audio.ensure();
    game.strike = { t: 0, dur: 0.12, from: 14 + game.power * 46 };
    setState('striking');
  }

  function launchCueBall() {
    const cue = cueBall();
    const speed = MAX_SPEED * (0.12 + 0.88 * game.power);
    cue.vx = Math.cos(game.aim) * speed; cue.vy = Math.sin(game.aim) * speed;
    if (!audio.play('shot', 0.4 + 0.6 * game.power)) audio.click(Math.min(1, game.power));
    game.shot = { firstContact: null, pocketed: [], rails: 0, player: game.current, breakShot: game.breakShot, groupsBefore: [...game.groups],
      clearedBefore: game.groups[game.current] ? remaining(game.groups[game.current]) === 0 : false };
    game.stats[game.current].shots++;
    game.ballInHand = false; game.kitchenOnly = false;
    setState('rolling');
    setStatus(game.breakShot ? 'Break' : `Shot ${game.stats[game.current].shots}`, `${playerName(game.current)} shooting`, '', '');
  }

  function resolveShot() {
    const shot = game.shot; game.shot = null;
    const me = shot.player, opp = 1 - me;
    const cue = cueBall();
    const scratch = !cue.inPlay;
    const potted = shot.pocketed.filter((b) => b.n !== 0);
    const eight = potted.find((b) => b.n === 8);
    const myGroup = game.groups[me];
    let foul = null;

    if (scratch) foul = 'Scratch — cue ball pocketed';
    else if (!shot.firstContact) foul = 'No ball was hit';
    else if (!shot.breakShot) {
      const first = shot.firstContact;
      if (!myGroup && first.n === 8) foul = 'Hit the 8-ball first on an open table';
      else if (myGroup && first.type !== myGroup && !(first.n === 8 && shot.clearedBefore)) foul = `Hit ${first.n === 8 ? 'the 8-ball' : 'an opponent\u2019s ball'} first`;
    }
    if (!foul && !shot.breakShot && myGroup && potted.some((b) => b.n !== 8 && b.type !== myGroup)) foul = 'Potted an opponent\u2019s ball';

    // 8-ball on the break: re-spot, play on.
    if (eight && shot.breakShot) {
      respotEight();
      potted.splice(potted.indexOf(eight), 1);
    } else if (eight && !shot.clearedBefore) {
      // 8-ball sunk while balls are still left: the game goes on, the 8 goes back to its rack spot, the opponent gets 2 shots.
      respotEight();
      potted.splice(potted.indexOf(eight), 1);
      foul = foul || 'Sank the 8-ball too early \u2014 it goes back';
    } else if (eight) {
      const win = shot.clearedBefore && !foul;
      return endGame(win ? me : opp, win ? `${playerName(me)} cleared the table and sank the 8-ball.`
        : foul ? `${playerName(me)} sank the 8-ball but fouled (${foul.toLowerCase()}).` : `${playerName(me)} sank the 8-ball too early.`);
    }

    game.stats[me].potted += potted.length;
    if (foul) game.stats[me].fouls++;

    // Group assignment on an open table (not on the break).
    let assignedNow = null;
    if (!shot.breakShot && !game.groups[me] && !foul && potted.length) {
      const solids = potted.filter((b) => b.type === 'solid').length, stripes = potted.filter((b) => b.type === 'stripe').length;
      assignedNow = solids === stripes ? potted[0].type : solids > stripes ? 'solid' : 'stripe';
      game.groups[me] = assignedNow; game.groups[opp] = assignedNow === 'solid' ? 'stripe' : 'solid';
    }

    const groupNow = game.groups[me];
    const pottedOwn = potted.some((b) => groupNow ? b.type === groupNow : true);
    const continueTurn = !foul && pottedOwn;
    game.breakShot = false;

    if (foul) {
      if (!audio.play('foul')) audio.burst(180, 1, 0.25, 0.3);
      game.current = opp; game.visits = 2;
      game.ballInHand = scratch; game.kitchenOnly = true;      // a pocketed cue ball is placed behind the head line only
      if (scratch) placeCueDefault();
      setStatus('Foul', `${playerName(opp)} \u2014 2 shots`, foul, 'foul');
    } else if (continueTurn) {
      const names = potted.map((b) => b.n).join(', ');
      setStatus(shot.breakShot ? 'Break' : 'Nice', `${playerName(me)} shoots again`, assignedNow ? `${playerName(me)} is ${groupLabel(assignedNow)} · potted ${names}` : `Potted ${names}`, 'good');
    } else if (game.visits > 1) {
      game.visits--;
      setStatus('2nd shot', `${playerName(me)} shoots again`, 'One shot left from the foul', '');
    } else {
      game.current = opp; game.visits = 1;
      setStatus('Turn', `${playerName(opp)} to shoot`, game.groups[opp] ? `${groupLabel(game.groups[opp])}${remaining(game.groups[opp]) === 0 ? ' · on the 8-ball' : ''}` : 'Open table', '');
    }
    if (!foul && game.groups[me] && remaining(game.groups[me]) === 0 && continueTurn) {
      setStatus('On the 8', `${playerName(me)} shoots again`, 'Pocket the 8-ball to win', 'good');
    }
    game.cueValid = true;
    // default aim: toward nearest legal object ball
    const target = nearestLegalBall(game.current);
    if (target) game.aim = Math.atan2(target.y - cue.y, target.x - cue.x);
    setState('aim');
    updateHud();
    scheduleAi();
  }

  function respotEight() {
    const eight = game.balls.find((b) => b.n === 8);
    const dx = (2 * R + 0.6) * Math.cos(Math.PI / 6);
    let x = FOOT.x + 2 * dx, y = FOOT.y;              // its original place in the rack (middle of the 3rd row)
    while (overlapsBall(x, y, eight) && x < PLAY.right - R) x += 2;
    if (overlapsBall(x, y, eight)) { x = FOOT.x + 2 * dx; while (overlapsBall(x, y, eight) && x > PLAY.left + R) x -= 2; }
    Object.assign(eight, { x, y, vx: 0, vy: 0, inPlay: true, sinking: null });
  }

  function placeCueDefault() {
    const cue = cueBall();
    const candidates = game.kitchenOnly ? [[HEAD_X, 450], [HEAD_X - 60, 450], [HEAD_X, 380], [HEAD_X, 520], [HEAD_X - 120, 450]] : [[HEAD_X, 450], [720, 450], [HEAD_X, 350], [HEAD_X, 550], [FOOT.x, 450], [360, 450]];
    for (const [x, y] of candidates) {
      Object.assign(cue, { x, y, vx: 0, vy: 0, inPlay: true, sinking: null });
      if (legalCuePosition(x, y)) return;
    }
    for (let i = 0; i < 400; i++) {
      const x = PLAY.left + R + Math.random() * ((game.kitchenOnly ? HEAD_X : PLAY.right - R) - PLAY.left - R);
      const y = PLAY.top + R + Math.random() * (PLAY.bottom - PLAY.top - 2 * R);
      if (legalCuePosition(x, y)) { Object.assign(cue, { x, y }); return; }
    }
  }

  function legalTargets(player) {
    const g = game.groups[player];
    const live = game.balls.filter((b) => b.n !== 0 && b.inPlay && !b.sinking);
    if (!g) return live.filter((b) => b.n !== 8);
    const own = live.filter((b) => b.type === g);
    return own.length ? own : live.filter((b) => b.n === 8);
  }
  function nearestLegalBall(player) {
    const cue = cueBall(); let best = null, bd = Infinity;
    for (const b of legalTargets(player)) { const d = Math.hypot(b.x - cue.x, b.y - cue.y); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  /* Paper confetti when the game ends */
  const confetti = { cv: null, ctx: null, parts: [], raf: 0, t0: 0 };
  function startConfetti() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!confetti.cv) {
      const cv = document.createElement('canvas'); cv.setAttribute('aria-hidden', 'true');
      cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:30;pointer-events:none';
      document.body.appendChild(cv); confetti.cv = cv; confetti.ctx = cv.getContext('2d');
    }
    const cv = confetti.cv, d = Math.min(window.devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
    cv.width = Math.round(W * d); cv.height = Math.round(H * d);
    const colors = ['#ffd83a', '#ff4d4d', '#3ddc84', '#4da3ff', '#ff8a2b', '#ffffff', '#c06bff'];
    const rnd = (a, b) => a + Math.random() * (b - a), mk = (x, y, vx, vy) => ({ x, y, vx, vy, w: rnd(7, 13), h: rnd(10, 18), rot: rnd(0, 6.28), vr: rnd(-8, 8), ph: rnd(0, 6.28), c: colors[(Math.random() * colors.length) | 0], life: rnd(3.2, 5) });
    confetti.parts = [];
    for (let i = 0; i < 70; i++) {                                    // two bursts from the bottom corners
      const left = i % 2 === 0, sp = rnd(520, 980) * Math.max(0.7, H / 800);
      confetti.parts.push(mk(left ? 0 : W, H, (left ? 1 : -1) * rnd(140, 460), -sp));
    }
    for (let i = 0; i < 90; i++) confetti.parts.push(mk(rnd(0, W), rnd(-H * 0.6, -10), rnd(-40, 40), rnd(40, 160)));   // paper falling from above
    confetti.t0 = performance.now(); let last = confetti.t0;
    cancelAnimationFrame(confetti.raf);
    const step = (now) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now;
      const g = confetti.ctx; g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
      confetti.parts = confetti.parts.filter((p) => p.y < H + 30 && p.life > 0 && !ui.endOverlay.hidden);
      for (const p of confetti.parts) {
        p.vy += 620 * dt; p.vx *= 1 - 1.4 * dt; p.vy *= 1 - 0.9 * dt;       // gravity + air drag, so paper drifts down
        p.x += (p.vx + Math.sin(p.ph) * 40) * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.ph += 4 * dt; p.life -= dt;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, p.life * 1.5);
        g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.ph)), p.w, p.h * Math.abs(Math.cos(p.ph)) + 1); g.restore();
      }
      if (confetti.parts.length) confetti.raf = requestAnimationFrame(step); else g.clearRect(0, 0, W, H);
    };
    confetti.raf = requestAnimationFrame(step);
  }

  function endGame(winner, reason) {
    game.winner = winner;
    setState('over');
    if (!audio.play('gameover')) audio.burst(300, 0.8, 0.4, 0.3);
    setStatus('Game over', `${playerName(winner)} wins`, reason, 'good');
    ui.endTitle.textContent = `${playerName(winner)} win${game.mode === 'cpu' && winner === 0 ? '' : 's'}`;
    ui.endReason.textContent = reason;
    ui.endStats.replaceChildren();
    [0, 1].forEach((i) => {
      const s = game.stats[i];
      const el = document.createElement('div'); el.className = 'end-stat';
      el.innerHTML = `<b>${s.potted}</b><span>${playerName(i).toUpperCase()} · ${s.shots} SHOTS · ${s.fouls} FOULS</span>`;
      ui.endStats.appendChild(el);
    });
    updateHud();
    setTimeout(() => { if (game.state !== 'over') return; ui.endOverlay.hidden = false; ui.rematch.focus(); startConfetti(); }, 650);
  }

  /* ------------------------------------------------------------------ */
  /* Computer opponent                                                   */
  /* ------------------------------------------------------------------ */
  function evaluateShots(cx, cy, player) {
    const cue = cueBall();
    const targets = legalTargets(player);
    const out = [];
    for (const t of targets) {
      for (const p of POCKETS) {
        // aim slightly inside the pocket mouth
        const ax = p.x + (WORLD.cx - p.x) * (p.corner ? 0.025 : 0.0), ay = p.y + (WORLD.cy - p.y) * (p.corner ? 0.025 : 0.03);
        const tdx = ax - t.x, tdy = ay - t.y, td = Math.hypot(tdx, tdy), ux = tdx / td, uy = tdy / td;
        const gx = t.x - ux * 2 * R, gy = t.y - uy * 2 * R;
        const cdx = gx - cx, cdy = gy - cy, cd = Math.hypot(cdx, cdy); if (cd < 1) continue;
        const vx = cdx / cd, vy = cdy / cd;
        const cosCut = vx * ux + vy * uy;
        if (cosCut < 0.22) continue;
        if (!pathClear(cx, cy, gx, gy, cue, t)) continue;
        if (!pathClear(t.x, t.y, ax, ay, t, cue)) continue;
        const score = Math.pow(cosCut, 2.2) * (1 / (1 + cd / 700)) * (1 / (1 + td / 500)) * (p.corner ? 1 : 0.85);
        const power = Math.max(0.28, Math.min(0.9, 0.26 + (cd + td / Math.max(cosCut, 0.3)) / 2400));
        out.push({ score, angle: Math.atan2(vy, vx), power, target: t });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function scheduleAi() {
    if (!isCpuTurn() || game.state !== 'aim') return;
    game.aiTimer = 0.9;
  }

  function runAi() {
    const cue = cueBall();
    if (game.ballInHand) {
      // Pick a cue-ball spot with the best available shot.
      let best = null;
      const xMax = game.kitchenOnly ? HEAD_X : PLAY.right - R;
      for (let i = 0; i < 90; i++) {
        const x = PLAY.left + R + Math.random() * (xMax - PLAY.left - R), y = PLAY.top + R + Math.random() * (PLAY.bottom - PLAY.top - 2 * R);
        if (!legalCuePosition(x, y)) continue;
        const shots = evaluateShots(x, y, 1);
        const s = shots.length ? shots[0].score : 0;
        if (!best || s > best.score) best = { x, y, score: s };
      }
      if (best) { cue.x = best.x; cue.y = best.y; }
      game.cueValid = legalCuePosition(cue.x, cue.y);
      if (!game.cueValid) placeCueDefault();
    }
    let plan;
    if (game.breakShot) {
      const apex = game.balls.find((b) => b.n === 1) || game.balls[1];
      plan = { angle: Math.atan2(apex.y - cue.y + (Math.random() - 0.5) * 6, apex.x - cue.x), power: 1 };
    } else {
      const shots = evaluateShots(cue.x, cue.y, 1);
      if (shots.length) {
        const pick = shots[0];
        const error = (Math.random() - 0.5) * (0.9 - pick.score * 0.6) * Math.PI / 180 * 1.4;
        plan = { angle: pick.angle + error, power: pick.power };
      } else {
        // safety: hit the nearest legal ball softly, preferring a clear path
        const targets = legalTargets(1).map((t) => ({ t, d: Math.hypot(t.x - cue.x, t.y - cue.y), clear: pathClear(cue.x, cue.y, t.x, t.y, cue, t) }))
          .sort((a, b) => (a.clear === b.clear ? a.d - b.d : a.clear ? -1 : 1));
        const t = targets[0] ? targets[0].t : game.balls[1];
        const hit = castRay(cue.x, cue.y, Math.cos(Math.atan2(t.y - cue.y, t.x - cue.x)), Math.sin(Math.atan2(t.y - cue.y, t.x - cue.x)), cue);
        plan = { angle: Math.atan2(t.y - cue.y, t.x - cue.x) + (Math.random() - 0.5) * 0.02, power: hit.kind === 'ball' ? 0.38 : 0.55 };
      }
    }
    game.aimTarget = null;
    game.aiTween = { from: game.aim, to: plan.angle, power: plan.power, t: 0, dur: 0.7 };
  }

  function updateAi(dt) {
    if (!isCpuTurn() || game.state !== 'aim') return;
    if (game.aiTimer > 0) {
      game.aiTimer -= dt;
      if (game.aiTimer <= 0) runAi();
      return;
    }
    const tw = game.aiTween;
    if (!tw) return;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur), e = 1 - Math.pow(1 - k, 3);
    let delta = tw.to - tw.from; while (delta > Math.PI) delta -= 2 * Math.PI; while (delta < -Math.PI) delta += 2 * Math.PI;
    game.aim = tw.from + delta * e;
    game.power = game.power + (tw.power - game.power) * Math.min(1, dt * 6);
    invalidate();
    if (k >= 1) {
      game.aim = tw.to; game.power = tw.power; game.aiTween = null;
      setTimeout(() => { if (game.state === 'aim' && isCpuTurn()) shoot(); }, 350);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  const FIT_W = 1230, FIT_H = 690;
  const view = { w: 0, h: 0, dpr: 1, scale: 1, portrait: false, matrix: new DOMMatrix(), inverse: new DOMMatrix(), tableCache: null, ready: false };
  const sprites = { k: 1, D: 0, shade: null, shadow: null, cue: null };
  const CUE_LEN = 440, CUE_M = 8, CUE_H = 30;
  let dirty = true;
  const invalidate = () => { dirty = true; };
  const tableImage = new Image();
  tableImage.onload = () => { view.ready = true; view.tableCache = null; invalidate(); };
  tableImage.src = 'pool-table.svg';

  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // sharp but bounded: at most ~3.4M canvas pixels, whatever the screen
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = rect.width * rect.height;
    if (px * dpr * dpr > 3.4e6) dpr = Math.max(1, Math.sqrt(3.4e6 / px));
    view.w = rect.width; view.h = rect.height; view.dpr = dpr;
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    view.portrait = rect.height > rect.width;
    document.documentElement.classList.toggle('portrait', view.portrait);
    // fit the wooden table itself (1230 x 690 world units, centred on the world centre) edge to edge
    view.scale = view.portrait ? Math.min(rect.width / FIT_H, rect.height / FIT_W) : Math.min(rect.width / FIT_W, rect.height / FIT_H);
    const m = new DOMMatrix().scale(dpr).translate(rect.width / 2, rect.height / 2).rotate(view.portrait ? 90 : 0).scale(view.scale).translate(-WORLD.cx, -WORLD.cy);
    view.matrix = m; view.inverse = m.inverse();
    view.tableCache = null;
    layoutControls(rect.width, rect.height);
    buildSprites();
    for (const b of game.balls) b.dirty = true;
    invalidate();
  }

  /* Controls sit on the table's wooden rails, between the pockets, and the layout is point-symmetric:
     power bar on the top rail (left half), aim line on the bottom rail (right half). Works in landscape and portrait. */
  function layoutControls(w, h) {
    const root = document.documentElement.style, px = (v) => `${Math.round(v)}px`, s = view.scale;
    const set = (o) => { for (const k in o) root.setProperty(k, o[k]); };
    if (!view.portrait) {
      const tl = (w - FIT_W * s) / 2, tt = (h - FIT_H * s) / 2, seg = 400 * s;
      const avail = 435 * s;                                           // right-hand top rail segment, pocket to pocket
      set({
        '--hud-r': px(Math.max(8, tl + 135 * s)), '--hud-l': '0px', '--hud-top': px(Math.max(4, tt + 47 * s - 13)),
        '--hud-k': String(Math.max(0.6, Math.min(1, avail / 206))),
        '--pow-x': px(tl + 880 * s), '--pow-w': px(Math.max(170, seg)), '--pow-top': px(Math.min(h - 50, tt + 643 * s - 23)),
        '--strip-x': px(tl + 350 * s), '--strip-w': px(Math.max(170, seg)), '--strip-b': px(Math.max(4, h - (tt + 47 * s) - 23)),
        '--menu-x': px(Math.max(8, tl + 150 * s)), '--menu-y': px(Math.max(4, tt + 643 * s - 17))
      });
    } else {
      const tt = (h - FIT_W * s) / 2, seg = Math.max(170, 400 * s);
      set({
        '--hud-r': '10px', '--hud-l': '54px', '--hud-top': '10px', '--hud-k': '1', '--chip-y': px(h / 2 - 150),
        '--pow-x': px(w / 2), '--pow-w': px(seg), '--pow-top': px(Math.min(h - 50, tt + 1177 * s - 23)),
        '--strip-x': px(w / 2), '--strip-w': px(seg), '--strip-b': px(Math.max(4, h - (tt + 53 * s) - 23)),
        '--menu-x': '10px', '--menu-y': '8px'
      });
    }
  }

  /* Everything that is the same for every ball / every frame is painted once per resize into small sprites. */
  function buildSprites() {
    const k = view.scale * view.dpr, D = Math.ceil(2 * R * k) + 4;
    sprites.k = k; sprites.D = D;
    // light + shading overlay shared by all balls
    const sh = mkCanvas(D, D), g = sh.getContext('2d');
    g.translate(D / 2, D / 2); g.scale(k, k);
    const r = R;
    const gr = g.createRadialGradient(-r * 0.38, -r * 0.42, r * 0.1, 0, 0, r * 1.05);
    gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.22, 'rgba(255,255,255,.12)'); gr.addColorStop(0.6, 'rgba(0,0,0,.05)'); gr.addColorStop(1, 'rgba(0,0,0,.5)');
    g.fillStyle = gr; g.fillRect(-r - 1, -r - 1, 2 * r + 2, 2 * r + 2);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.ellipse(-r * 0.4, -r * 0.45, r * 0.16, r * 0.1, -0.6, 0, Math.PI * 2); g.fill();
    sprites.shade = sh;
    // soft shadow (a radial gradient, not a blur filter)
    const SW = Math.ceil(2 * R * 1.5 * k) + 4, sd = mkCanvas(SW, SW), sg = sd.getContext('2d');
    sg.translate(SW / 2, SW / 2); sg.scale(k, k);
    const sr = R * 1.5, sgr = sg.createRadialGradient(0, 0, R * 0.55, 0, 0, sr);
    sgr.addColorStop(0, 'rgba(0,0,0,.42)'); sgr.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = sgr; sg.beginPath(); sg.arc(0, 0, sr, 0, Math.PI * 2); sg.fill();
    sprites.shadow = sd;
    // the cue
    const cw = (CUE_LEN + 2 * CUE_M) * k, ch = CUE_H * k, cu = mkCanvas(cw, ch), cg = cu.getContext('2d');
    cg.scale(k, k); cg.translate(CUE_M, CUE_H / 2);
    cg.shadowColor = 'rgba(0,0,0,.4)'; cg.shadowBlur = 6 * k; cg.shadowOffsetX = 2 * k; cg.shadowOffsetY = 4 * k;
    const len = CUE_LEN, grad = cg.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, '#e9d7b0'); grad.addColorStop(0.35, '#caa571'); grad.addColorStop(0.72, '#6e4425'); grad.addColorStop(1, '#2b1a10');
    cg.fillStyle = grad;
    cg.beginPath(); cg.moveTo(0, -2.2); cg.lineTo(len, -5.2); cg.lineTo(len, 5.2); cg.lineTo(0, 2.2); cg.closePath(); cg.fill();
    cg.shadowColor = 'transparent';
    cg.strokeStyle = 'rgba(255,255,255,.28)'; cg.lineWidth = 0.9; cg.beginPath(); cg.moveTo(6, -1); cg.lineTo(len - 10, -3); cg.stroke();
    cg.fillStyle = '#1d1511'; cg.fillRect(len * 0.66, -4.5, len * 0.2, 9);
    cg.fillStyle = '#f1ece0'; cg.fillRect(0, -2.3, 9, 4.6);
    cg.fillStyle = '#3f6fb8'; cg.beginPath(); cg.arc(0, 0, 2.3, Math.PI / 2, Math.PI * 1.5); cg.fill();
    sprites.cue = cu;
  }

  function applyWorld(c) { const m = view.matrix; c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); }

  function drawTable() {
    if (!view.ready) return;
    if (!view.tableCache) {
      const off = document.createElement('canvas'); off.width = canvas.width; off.height = canvas.height;
      const oc = off.getContext('2d');
      applyWorld(oc);
      oc.drawImage(tableImage, WORLD.x, WORLD.y, WORLD.w, WORLD.h);
      view.tableCache = off;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(view.tableCache, 0, 0);
  }

  // A ball's face is re-painted only while it moves (it rolls); a resting ball is just one drawImage.
  function paintBall(b) {
    const D = sprites.D, k = sprites.k;
    if (!b.spr) b.spr = document.createElement('canvas');
    if (b.spr.width !== D) { b.spr.width = D; b.spr.height = D; }
    const g = b.spr.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, D, D);
    g.translate(D / 2, D / 2); g.scale(k, k);
    const r = R;
    g.save(); g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.clip();
    g.fillStyle = b.type === 'stripe' ? '#f4f1e8' : b.color;
    g.fillRect(-r, -r, 2 * r, 2 * r);
    const isStripe = b.type === 'stripe';
    // half balls: the colour band is drawn exactly as on a sphere (|p·pole| < 0.55). The pole is kept mostly side-on (|z| <= 0.5),
    // so the band always crosses the middle of the ball and both white caps always show, while it still visibly rolls.
    let s = b.s;
    if (isStripe) { const z = Math.max(-0.5, Math.min(0.5, s.z)); s = Math.hypot(s.x, s.y) < 1e-3 ? { x: 0.87, y: 0, z: z } : normalize3(s.x, s.y, z); }
    if (isStripe) {
      if (!b.bandCv || b.bandCv.width !== D) { b.bandCv = document.createElement('canvas'); b.bandCv.width = D; b.bandCv.height = D; b.bandCtx = b.bandCv.getContext('2d'); b.bandImg = b.bandCtx.createImageData(D, D); }
      const img = b.bandImg, d = img.data, cx = D / 2, rr = D / 2, cr = parseInt(b.color.slice(1, 3), 16), cg = parseInt(b.color.slice(3, 5), 16), cb = parseInt(b.color.slice(5, 7), 16);
      const HALF = 0.55, EDGE = 1.6 / rr;
      for (let y = 0; y < D; y++) {
        const ny = (y + 0.5 - cx) / rr;
        for (let x = 0; x < D; x++) {
          const nx = (x + 0.5 - cx) / rr, q = nx * nx + ny * ny, o = (y * D + x) * 4;
          if (q >= 1) { d[o + 3] = 0; continue; }
          const dot = Math.abs(nx * s.x + ny * s.y + Math.sqrt(1 - q) * s.z);
          let a = (HALF - dot) / EDGE + 0.5; a = a < 0 ? 0 : a > 1 ? 1 : a;
          d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = a * 255;
        }
      }
      b.bandCtx.putImageData(img, 0, 0);
      g.drawImage(b.bandCv, -D / (2 * k), -D / (2 * k), D / k, D / k);
    }
    if (b.n !== 0) {
      // solids: number disc at the pole; halves: number disc sits in the middle of the band, facing the viewer
      const pole = isStripe ? normalize3(-s.z * s.x, -s.z * s.y, 1 - s.z * s.z) : (s.z >= 0 ? s : { x: -s.x, y: -s.y, z: -s.z });
      const px = pole.x * r, py = pole.y * r, sq = Math.max(0.05, pole.z), spotR = r * (isStripe ? 0.42 : 0.5);
      g.save();
      g.translate(px, py); g.rotate(Math.atan2(pole.y, pole.x)); g.scale(sq, 1);
      g.fillStyle = '#f6f3ea'; g.beginPath(); g.arc(0, 0, spotR, 0, Math.PI * 2); g.fill();
      g.rotate(-Math.atan2(pole.y, pole.x));
      g.fillStyle = '#1b1b1b'; g.font = `bold ${b.n > 9 ? spotR * 1.15 : spotR * 1.35}px Helvetica, Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (sq > 0.25) g.fillText(String(b.n), 0, spotR * 0.06);
      g.restore();
    }
    g.drawImage(sprites.shade, -D / (2 * k), -D / (2 * k), D / k, D / k);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.6; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    b.dirty = false;
  }

  function drawBall(b) {
    if (b.dirty || !b.spr || b.spr.width !== sprites.D) paintBall(b);
    const k = sprites.k, sc = b.sinking ? b.sinking.scale : 1, w = sprites.D / k * sc;
    if (!b.sinking) { const sw = sprites.shadow.width / k; ctx.drawImage(sprites.shadow, b.x + 2.2 - sw / 2, b.y + 3.2 - sw / 2, sw, sw); }
    ctx.drawImage(b.spr, b.x - w / 2, b.y - w / 2, w, w);
  }

  function drawGuide() {
    const cue = cueBall();
    const dx = Math.cos(game.aim), dy = Math.sin(game.aim);
    const hit = castRay(cue.x, cue.y, dx, dy, cue);
    const gx = cue.x + dx * hit.dist, gy = cue.y + dy * hit.dist;
    ctx.save();
    ctx.setLineDash([5, 7]); ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.moveTo(cue.x + dx * (R + 2), cue.y + dy * (R + 2)); ctx.lineTo(gx, gy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(gx, gy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fill();
    if (hit.kind === 'ball') {
      const t = hit.ball; const ox = t.x - gx, oy = t.y - gy, ol = Math.hypot(ox, oy) || 1, ux = ox / ol, uy = oy / ol;
      const cosCut = ux * dx + uy * dy;
      const len = 28 + 70 * Math.max(0, cosCut);
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(t.x + ux * R, t.y + uy * R); ctx.lineTo(t.x + ux * (R + len), t.y + uy * (R + len)); ctx.stroke();
      // cue ball deflection (tangent line)
      const tx = dx - ux * cosCut, ty = dy - uy * cosCut, tl = Math.hypot(tx, ty);
      if (tl > 0.08) {
        const dl = 22 + 50 * tl;
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + tx / tl * dl, gy + ty / tl * dl); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawCue(pullback) {
    const cue = cueBall(), k = sprites.k, spr = sprites.cue;
    ctx.save();
    ctx.translate(cue.x, cue.y); ctx.rotate(game.aim + Math.PI);
    const w = spr.width / k, h = spr.height / k;
    ctx.drawImage(spr, R + 4 + pullback - CUE_M, -h / 2, w, h);
    ctx.restore();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTable();
    applyWorld(ctx);
    if (game.state === 'menu') return;
    const cue = cueBall();
    const aiming = game.state === 'aim' || game.state === 'striking';
    // balls: sinking ones first (under), then resting
    for (const b of game.balls) if (b.inPlay && b.sinking) drawBall(b);
    for (const b of game.balls) if (b.inPlay && !b.sinking && b.n !== 0) drawBall(b);
    if (cue.inPlay && !cue.sinking) {
      if (aiming && game.cueValid && !(game.dragging === 'cue')) drawGuide();
      drawBall(cue);
      if (!game.cueValid || game.dragging === 'cue') {
        ctx.save(); ctx.beginPath(); ctx.arc(cue.x, cue.y, R + 4, 0, Math.PI * 2);
        ctx.strokeStyle = game.cueValid ? 'rgba(201,181,141,.9)' : 'rgba(226,100,80,.95)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
      }
      if (game.state === 'aim' && game.ballInHand && game.kitchenOnly && !isCpuTurn()) {
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.setLineDash([4, 8]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(HEAD_X, PLAY.top + 2); ctx.lineTo(HEAD_X, PLAY.bottom - 2); ctx.stroke(); ctx.restore();
      }
      if (aiming && game.cueValid && game.dragging !== 'cue') {
        let pull = 14 + game.power * 46;
        if (game.strike) { const k = Math.min(1, game.strike.t / game.strike.dur); pull = game.strike.from * (1 - k * k); }
        drawCue(pull);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                           */
  /* ------------------------------------------------------------------ */
  let last = performance.now(), acc = 0;
  function smoothAim(dt) {      // fine-aim target: ease toward it, so swipes feel liquid
    if (game.aimTarget === null) return;
    let d = game.aimTarget - game.aim; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) < 0.00002) { game.aim = game.aimTarget; game.aimTarget = null; }
    else game.aim += d * (1 - Math.exp(-dt * 26));
    invalidate();
  }
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (game.paused) dt = 0;
    let animating = false;
    if (game.paused) { /* frozen */ } else if (game.state === 'striking') {
      animating = true;
      game.strike.t += dt;
      if (game.strike.t >= game.strike.dur) { game.strike = null; launchCueBall(); }
    } else if (game.state === 'rolling') {
      animating = true;
      acc += dt;
      while (acc >= STEP) { stepPhysics(STEP); acc -= STEP; }
      if (!anyMoving()) { acc = 0; resolveShot(); }
    } else if (game.state === 'aim') {
      updateAi(dt); smoothAim(dt);
    }
    if (animating || dirty) { dirty = false; render(); }      // nothing moves while you aim: no redraw
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */
  function toWorld(e) {
    const rect = canvas.getBoundingClientRect();
    const p = view.inverse.transformPoint(new DOMPoint((e.clientX - rect.left) * view.dpr, (e.clientY - rect.top) * view.dpr));
    return { x: p.x, y: p.y };
  }
  function setAimTo(p) {
    const cue = cueBall(); const d = Math.hypot(p.x - cue.x, p.y - cue.y);
    if (d < 4) return;
    game.aimTarget = null;
    game.aim = Math.atan2(p.y - cue.y, p.x - cue.x);
    invalidate();
  }
  function moveCue(p) {
    const cue = cueBall(); const c = clampCue(p.x, p.y);
    cue.x = c.x; cue.y = c.y;
    game.cueValid = legalCuePosition(cue.x, cue.y);
    refreshControls(); invalidate();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (game.state !== 'aim' || isCpuTurn()) return;
    audio.ensure();
    canvas.setPointerCapture(e.pointerId);
    const p = toWorld(e); const cue = cueBall();
    if (game.ballInHand && Math.hypot(p.x - cue.x, p.y - cue.y) < R * 2.2) { game.dragging = 'cue'; moveCue(p); }
    else { game.dragging = 'aim'; setAimTo(p); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!game.dragging || game.state !== 'aim') return;
    const p = toWorld(e);
    if (game.dragging === 'cue') moveCue(p); else setAimTo(p);
  });
  const endDrag = (e) => {
    if (!game.dragging) return;
    if (game.dragging === 'cue') {
      if (!game.cueValid) { placeCueDefault(); game.cueValid = true; refreshControls(); }
      invalidate();
    }
    game.dragging = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* --- Power: pull the knob down, release to shoot (back to the top = cancel) --- */
  const pull = { id: null, x0: 0, range: 1, t: 0 };
  function setPull(t) {
    pull.t = t;
    const px = t * pull.range;
    ui.ppHandle.style.transform = `translateX(${view.portrait ? -px : px}px)`;
    ui.ppFill.style.width = t > 0 ? `${px + 31}px` : '0px';
    ui.ppVal.textContent = String(Math.round(t * 100));
    ui.power.classList.toggle('cancel', pull.id !== null && t < PULL_MIN);
  }
  function pullRange() { return Math.max(40, ui.power.clientWidth - ui.ppHandle.offsetWidth - 6); }
  ui.ppHandle.addEventListener('pointerdown', (e) => {
    if (game.state !== 'aim' || isCpuTurn() || !game.cueValid || pull.id !== null) return;
    e.preventDefault(); audio.ensure();
    pull.id = e.pointerId; pull.x0 = e.clientX; pull.range = pullRange();
    try { ui.ppHandle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    ui.power.classList.add('active'); setPull(0);
  });
  ui.ppHandle.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pull.id) return;
    const t = Math.max(0, Math.min(1, (view.portrait ? pull.x0 - e.clientX : e.clientX - pull.x0) / pull.range));
    setPull(t); game.power = Math.max(0.05, t); invalidate();      // the cue on the table draws back as you pull
  });
  const releasePull = (e, cancelled) => {
    if (e.pointerId !== pull.id) return;
    pull.id = null;
    const t = pull.t;
    ui.power.classList.remove('active', 'cancel');
    setPull(0);
    if (!cancelled && t >= PULL_MIN && game.state === 'aim' && !isCpuTurn()) { game.power = Math.max(0.05, t); shoot(); }
    else { game.power = REST_POWER; invalidate(); }
  };
  ui.ppHandle.addEventListener('pointerup', (e) => releasePull(e, false));
  ui.ppHandle.addEventListener('pointercancel', (e) => releasePull(e, true));
  ui.ppHandle.addEventListener('lostpointercapture', (e) => { if (e.pointerId === pull.id) releasePull(e, true); });

  /* --- Aim: slide the line. Tiny angle per pixel on purpose, eased for smoothness --- */
  const AIM_PER_PX = 0.05 * Math.PI / 180;       // radians of aim per pixel of finger travel (raise for faster aiming)
  const strip = { id: null, x: 0, off: 0 };
  ui.aimStrip.addEventListener('pointerdown', (e) => {
    if (game.state !== 'aim' || isCpuTurn() || strip.id !== null) return;
    e.preventDefault(); audio.ensure();
    strip.id = e.pointerId; strip.x = e.clientX;
    try { ui.aimStrip.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
  ui.aimStrip.addEventListener('pointermove', (e) => {
    if (e.pointerId !== strip.id || game.state !== 'aim') return;
    const dx = e.clientX - strip.x; strip.x = e.clientX;
    if (!dx) return;
    game.aimTarget = (game.aimTarget === null ? game.aim : game.aimTarget) + dx * AIM_PER_PX;
    strip.off = (strip.off + dx) % 15;
    strip.acc = (strip.acc || 0) + Math.abs(dx); if (strip.acc >= 15) { strip.acc %= 15; audio.tick(); }
    ui.aimTicks.style.transform = `translateX(${strip.off}px)`;
    invalidate();
  });
  const endStrip = (e) => { if (e.pointerId === strip.id) strip.id = null; };
  ui.aimStrip.addEventListener('pointerup', endStrip);
  ui.aimStrip.addEventListener('pointercancel', endStrip);

  /* --- Keyboard (desktop) --- */
  let kbPower = 0.55;
  const nudgeAim = (dir, fine) => {
    if (game.state !== 'aim' || isCpuTurn()) return;
    game.aimTarget = (game.aimTarget === null ? game.aim : game.aimTarget) + dir * (fine ? 0.05 : 0.3) * Math.PI / 180; audio.tick(); invalidate();
  };
  window.addEventListener('keydown', (e) => {
    if (ui.helpDialog.open) return;
    if (game.state === 'over' || game.state === 'menu' || game.paused) return;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); nudgeAim(-1, e.shiftKey); break;
      case 'ArrowRight': e.preventDefault(); nudgeAim(1, e.shiftKey); break;
      case 'ArrowUp': case 'ArrowDown':
        e.preventDefault(); if (game.state !== 'aim' || isCpuTurn()) break;
        kbPower = Math.max(0.08, Math.min(1, kbPower + (e.key === 'ArrowUp' ? 0.05 : -0.05)));
        game.power = kbPower; invalidate(); setStatus('Power', `Power ${Math.round(kbPower * 100)}%`, '', ''); break;
      case ' ': case 'Enter':
        if (e.target && e.target.tagName === 'BUTTON') return;
        e.preventDefault(); if (game.state === 'aim' && !isCpuTurn() && game.cueValid) { game.power = kbPower; shoot(); } break;
      default: break;
    }
  });

  /* Buttons / overlays */
  document.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => { audio.ensure(); game.paused = false; ui.resume.hidden = true; newGame(btn.dataset.mode); }));
  ui.rematch.addEventListener('click', () => newGame(game.mode));
  ui.changeMode.addEventListener('click', () => { ui.endOverlay.hidden = true; ui.resume.hidden = true; ui.startOverlay.hidden = false; game.state = 'menu'; game.winner = null; hudCache.length = 0; updateHud(); refreshControls(); });
  ui.newGame.addEventListener('click', () => {
    if (game.state === 'menu') return;
    game.paused = true;
    ui.resume.hidden = game.state === 'over';
    ui.endOverlay.hidden = true;
    ui.startOverlay.hidden = false;
    refreshControls();
  });
  ui.resume.addEventListener('click', () => { game.paused = false; ui.startOverlay.hidden = true; ui.resume.hidden = true; refreshControls(); });
  const openHelp = () => { ui.helpDialog.showModal(); };
  ui.startHelp.addEventListener('click', openHelp);
  ui.helpClose.addEventListener('click', () => ui.helpDialog.close());
  ui.helpDialog.addEventListener('click', (e) => { if (e.target === ui.helpDialog) ui.helpDialog.close(); });

  const syncSound = () => { ui.sound.setAttribute('aria-pressed', String(audio.enabled)); ui.sound.textContent = audio.enabled ? 'Sound: On' : 'Sound: Off'; };
  ui.sound.addEventListener('click', () => { audio.toggle(); syncSound(); });
  syncSound();

  /* PWA: install prompt, offline indicator, service worker */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; ui.install.hidden = false; });
  ui.install.addEventListener('click', async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; ui.install.hidden = true; });
  window.addEventListener('appinstalled', () => { ui.install.hidden = true; });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { try { navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (_) { /* unsupported context */ } });
  }

  /* Boot */
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));
  window.addEventListener('resize', () => { clearTimeout(resize.t); resize.t = setTimeout(resize, 80); });
  resize();
  updateHud();
  refreshControls();
  requestAnimationFrame(frame);
  window.__eight = { game, endGame, updateHud };
})();
