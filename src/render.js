import { MAX_FIRE_FUEL } from './game/game.js';
import { T, TS, WALL_HP } from './game/world.js';

const COL = {
  [T.WATER]: ['#2b5d82', '#2f6489'],
  [T.SAND]: ['#cdb26e', '#c6aa66'],
  [T.GRASS]: ['#4d7a3a', '#52813f'],
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('This browser cannot create a 2D canvas.');
    this.dark = document.createElement('canvas');
    this.dctx = this.dark.getContext('2d');
    this.cam = { x: 0, y: 0 };
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.cv.width = this.W * this.dpr;
    this.cv.height = this.H * this.dpr;
    this.dark.width = this.W;
    this.dark.height = this.H;
  }

  snapCamera(game) {
    this.cam.x = game.player.x;
    this.cam.y = game.player.y;
  }

  screenToWorld(sx, sy) {
    return { x: sx + this.cam.x - this.W / 2, y: sy + this.cam.y - this.H / 2 };
  }

  render(game, { cursor = null, showGhost = true } = {}) {
    const { ctx, W, H, cam } = this;
    const P = game.player;
    const time = game.time;
    const world = game.world;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    cam.x += (P.x - cam.x) * 0.18;
    cam.y += (P.y - cam.y) * 0.18;
    const shake = this.reducedMotion ? 0 : game.shake;
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    const offX = W / 2 - cam.x + sx;
    const offY = H / 2 - cam.y + sy;
    ctx.fillStyle = '#2b5d82';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(offX, offY);
    const x0 = Math.floor((cam.x - W / 2) / TS) - 1;
    const x1 = Math.floor((cam.x + W / 2) / TS) + 1;
    const y0 = Math.floor((cam.y - H / 2) / TS) - 1;
    const y1 = Math.floor((cam.y + H / 2) / TS) + 1;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = world.tileAt(x, y);
        const pal = COL[t] || COL[T.GRASS];
        ctx.fillStyle = pal[(x + y) & 1];
        ctx.fillRect(x * TS, y * TS, TS + 1, TS + 1);
        if (t === T.WATER && world.hash(x, y, 5) < 0.2) {
          ctx.fillStyle = '#ffffff18';
          const wob = this.reducedMotion ? 0 : Math.sin(time * 2 + x) * 3;
          ctx.fillRect(x * TS + 6 + wob, y * TS + 14, 12, 2);
        }
        if (t === T.GRASS && world.hash(x, y, 6) < 0.12) {
          ctx.fillStyle = '#3e6a2e';
          ctx.fillRect(x * TS + 8, y * TS + 10, 2, 5);
          ctx.fillRect(x * TS + 14, y * TS + 12, 2, 4);
        }
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = world.tileAt(x, y);
        const cx = x * TS + 16;
        const cy = y * TS + 16;
        if (t === T.TREE) {
          ctx.fillStyle = '#5b3d22';
          ctx.fillRect(cx - 3, cy + 2, 6, 12);
          ctx.fillStyle = '#2f5a2a';
          ctx.beginPath();
          ctx.arc(cx, cy - 3, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#3b6e33';
          ctx.beginPath();
          ctx.arc(cx - 4, cy - 6, 7, 0, Math.PI * 2);
          ctx.fill();
        } else if (t === T.ROCK) {
          ctx.fillStyle = '#7d8791';
          ctx.beginPath();
          ctx.moveTo(cx - 12, cy + 9);
          ctx.lineTo(cx - 8, cy - 8);
          ctx.lineTo(cx + 4, cy - 11);
          ctx.lineTo(cx + 12, cy + 2);
          ctx.lineTo(cx + 9, cy + 10);
          ctx.fill();
          ctx.fillStyle = '#a0aab4';
          ctx.fillRect(cx - 5, cy - 6, 6, 4);
        } else if (t === T.BUSH) {
          ctx.fillStyle = '#2f6a2e';
          ctx.beginPath();
          ctx.arc(cx, cy + 2, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#d23a3a';
          for (const [a, b] of [[-4, 0], [3, -2], [1, 5], [-2, 4], [5, 3]]) {
            ctx.beginPath();
            ctx.arc(cx + a, cy + b, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        const w = world.walls.get(`${x},${y}`);
        if (w) {
          ctx.fillStyle = '#8a5a30';
          ctx.fillRect(x * TS + 1, y * TS + 1, TS - 2, TS - 2);
          ctx.fillStyle = '#a8743f';
          ctx.fillRect(x * TS + 3, y * TS + 3, TS - 6, 6);
          ctx.fillRect(x * TS + 3, y * TS + 14, TS - 6, 6);
          ctx.fillStyle = '#0006';
          ctx.fillRect(x * TS + 1, y * TS + TS - 3, TS - 2, 2);
          if (w.hp < WALL_HP) {
            ctx.fillStyle = '#000a';
            ctx.fillRect(x * TS + 4, y * TS + TS - 8, (TS - 8) * (w.hp / WALL_HP), 3);
          }
        }
      }
    }

    for (const f of game.fires) {
      ctx.fillStyle = '#4a3520';
      ctx.fillRect(f.x - 8, f.y + 2, 16, 5);
      const fl = this.reducedMotion ? 0 : Math.sin(f.t * 14) * 2;
      ctx.fillStyle = '#e8672b';
      ctx.beginPath();
      ctx.moveTo(f.x - 7, f.y + 3);
      ctx.quadraticCurveTo(f.x, f.y - 16 + fl, f.x + 7, f.y + 3);
      ctx.fill();
      ctx.fillStyle = '#ffd35a';
      ctx.beginPath();
      ctx.moveTo(f.x - 4, f.y + 3);
      ctx.quadraticCurveTo(f.x, f.y - 9 - fl, f.x + 4, f.y + 3);
      ctx.fill();
      ctx.fillStyle = '#0008';
      ctx.fillRect(f.x - 9, f.y + 10, 18, 3);
      ctx.fillStyle = '#e8a33d';
      ctx.fillRect(f.x - 9, f.y + 10, 18 * clamp(f.fuel / MAX_FIRE_FUEL, 0, 1), 3);
    }

    for (const e of game.enemies) this.drawEnemy(e, P, time);

    for (const p of game.projs) {
      ctx.fillStyle = p.from === 'e' ? '#b57bff' : '#d8d8d8';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of game.swings) {
      ctx.strokeStyle = `rgba(255,240,200,${1 - s.t / 0.16})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(P.x, P.y, s.reach * 0.8, s.a - 1.0, s.a + 1.0);
      ctx.stroke();
    }

    // player
    ctx.fillStyle = '#0004';
    ctx.beginPath();
    ctx.ellipse(P.x, P.y + 7, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = P.inv > 0 && Math.floor(time * 30) % 2 ? '#fff' : '#e8d3a8';
    ctx.beginPath();
    ctx.arc(P.x, P.y, P.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3f6fb0';
    ctx.beginPath();
    ctx.arc(P.x, P.y, P.r, P.face + 0.9, P.face + 5.4);
    ctx.fill();
    const len = P.spear > 0 ? 30 : 18;
    ctx.strokeStyle = P.spear > 0 ? '#d8c28a' : '#7a5230';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(P.x + Math.cos(P.face) * 8, P.y + Math.sin(P.face) * 8);
    ctx.lineTo(P.x + Math.cos(P.face) * len, P.y + Math.sin(P.face) * len);
    ctx.stroke();

    for (const q of game.parts) {
      ctx.globalAlpha = clamp(q.life * 2, 0, 1);
      ctx.fillStyle = q.c;
      ctx.fillRect(q.x, q.y, 3, 3);
    }
    ctx.globalAlpha = 1;

    // wall placement preview
    if (showGhost && cursor && game.canAfford('wall')) {
      const gx = Math.floor(cursor.x / TS);
      const gy = Math.floor(cursor.y / TS);
      const ok = Math.hypot(cursor.x - P.x, cursor.y - P.y) <= 150 && !world.solid(gx, gy);
      ctx.strokeStyle = ok ? '#ffffff55' : '#ff6b5a55';
      ctx.lineWidth = 1;
      ctx.strokeRect(gx * TS + 0.5, gy * TS + 0.5, TS - 1, TS - 1);
    }

    // darkness with light around the player and fires
    const nf = game.nightFactor();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (nf > 0.02) {
      const d = this.dctx;
      d.globalCompositeOperation = 'source-over';
      d.clearRect(0, 0, W, H);
      d.fillStyle = `rgba(4,6,22,${nf * 0.9})`;
      d.fillRect(0, 0, W, H);
      d.globalCompositeOperation = 'destination-out';
      const hole = (x, y, r, a) => {
        const g = d.createRadialGradient(x, y, r * 0.1, x, y, r);
        g.addColorStop(0, `rgba(0,0,0,${a})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        d.fillStyle = g;
        d.beginPath();
        d.arc(x, y, r, 0, Math.PI * 2);
        d.fill();
      };
      hole(P.x + offX, P.y + offY, 150, 0.85);
      for (const f of game.fires) hole(f.x + offX, f.y + offY, 125 + (this.reducedMotion ? 0 : Math.sin(f.t * 9) * 5), 1);
      ctx.drawImage(this.dark, 0, 0, W, H);
    }
    if (P.hp < 35) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
      g.addColorStop(0, 'rgba(180,0,0,0)');
      g.addColorStop(1, `rgba(180,0,0,${0.45 * (1 - P.hp / 35)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (game.flash.t > 0) {
      ctx.fillStyle = '#f1e6d0';
      ctx.font = '700 14px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.globalAlpha = clamp(game.flash.t, 0, 1);
      ctx.fillText(game.flash.msg, W / 2, H * 0.74);
      ctx.globalAlpha = 1;
    }
  }

  drawEnemy(e, P, time) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0004';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + e.r * 0.7, e.r, e.r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = e.flash > 0 ? '#fff' : e.col;
    if (e.type === 'chaser') {
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === 'flanker') {
      const a = Math.atan2(P.y - e.y, P.x - e.x);
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(a) * e.r * 1.4, e.y + Math.sin(a) * e.r * 1.4);
      ctx.lineTo(e.x + Math.cos(a + 2.4) * e.r * 1.1, e.y + Math.sin(a + 2.4) * e.r * 1.1);
      ctx.lineTo(e.x + Math.cos(a - 2.4) * e.r * 1.1, e.y + Math.sin(a - 2.4) * e.r * 1.1);
      ctx.fill();
    } else if (e.type === 'spitter') {
      const spin = this.reducedMotion ? 0 : time;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * 1.047 + spin;
        ctx.lineTo(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
      }
      ctx.fill();
    } else {
      ctx.fillRect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
      ctx.strokeStyle = '#2c3622';
      ctx.lineWidth = 3;
      ctx.strokeRect(e.x - e.r + 1, e.y - e.r + 1, e.r * 2 - 2, e.r * 2 - 2);
    }
    // armour ring when they have adapted to melee
    if (e.maxhp > 4 && e.type !== 'brute') {
      ctx.strokeStyle = '#d9d2c088';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    const bw = 18;
    ctx.fillStyle = '#000a';
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 8, bw, 3);
    ctx.fillStyle = '#e55';
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 8, bw * clamp(e.hp / e.maxhp, 0, 1), 3);
    ctx.fillStyle = '#fff';
    ctx.fillRect(e.x - 3, e.y - 3, 2, 2);
    ctx.fillRect(e.x + 1, e.y - 3, 2, 2);
    if (e.state === 'dodge' || e.state === 'withdraw') {
      // small tell so players can read the learned behaviour
      ctx.fillStyle = e.state === 'dodge' ? '#ffffffaa' : '#6fd0c8aa';
      ctx.fillRect(e.x - 1, e.y - e.r - 14, 2, 4);
    }
  }
}
