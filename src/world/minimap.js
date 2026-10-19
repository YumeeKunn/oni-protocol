// ═══════════════ MINIMAP — building footprints, streets, team markers ═══════════════
import { MINIMAP } from '../core/config.js';

export class Minimap {
  constructor(canvas, pmap) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.pmap = pmap;
    this.size = canvas.width;
    this.range = MINIMAP.range;
    this.scale = this.size / (this.range * 2);
    this.bg = this.bakeBase();
    this.zone = '';
    this.pulse = 0;
  }

  /** pre-render streets + footprints once (world-aligned, 1 px = 1/S metres) */
  bakeBase() {
    const S = this.scale;
    const bounds = this.pmap.bounds || 52;
    const mapPx = Math.ceil(bounds * 2 * S) + 2;
    this.mapPx = mapPx;
    this.bounds = bounds;
    const cv = document.createElement('canvas');
    cv.width = cv.height = mapPx;
    const c = cv.getContext('2d');
    const toPx = (x, z) => [(x + bounds) * S, (z + bounds) * S];

    c.fillStyle = '#3a3324';
    c.fillRect(0, 0, mapPx, mapPx);

    // streets
    for (const s of this.pmap.streets) {
      const [px, pz] = toPx(s.x - s.w / 2, s.z - s.d / 2);
      c.fillStyle = s.kind === 'plaza' ? 'rgba(150,140,118,0.55)' : (s.kind === 'road' ? 'rgba(120,116,108,0.6)' : 'rgba(104,92,66,0.5)');
      c.fillRect(px, pz, s.w * S, s.d * S);
    }
    // building footprints
    c.strokeStyle = 'rgba(12,12,10,0.85)';
    c.lineWidth = 1;
    for (const b of this.pmap.blocks) {
      const [px, pz] = toPx(b.x, b.z);
      c.save();
      c.translate(px, pz);
      if (b.yaw) c.rotate(b.yaw);
      c.fillStyle = b.tall ? 'rgba(58,54,46,0.98)' : 'rgba(74,68,56,0.95)';
      c.fillRect(-b.w * S / 2, -b.d * S / 2, b.w * S, b.d * S);
      c.strokeRect(-b.w * S / 2, -b.d * S / 2, b.w * S, b.d * S);
      c.restore();
    }
    return cv;
  }

  draw(player, entities, game, dt) {
    const c = this.ctx, S = this.scale, half = this.size / 2;
    this.pulse += dt;
    c.clearRect(0, 0, this.size, this.size);
    c.save();
    c.beginPath();
    c.rect(0, 0, this.size, this.size);
    c.clip();
    c.drawImage(this.bg, half - (player.pos.x + this.bounds) * S, half - (player.pos.z + this.bounds) * S);

    // zone readout
    let zone = '';
    let bestD = 1e9;
    for (const z of game.world.zones) {
      const d = Math.hypot(player.pos.x - z.x, player.pos.z - z.z);
      if (d < z.r && d < bestD) { bestD = d; zone = z.name; }
    }
    this.zone = zone || 'OPEN GROUND';

    const px = (x) => half + (x - player.pos.x) * S;
    const pz = (z) => half + (z - player.pos.z) * S;

    // player vision cone
    c.save();
    c.translate(half, half);
    c.rotate(-player.yaw + Math.PI);
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, 26, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    c.closePath();
    const grd = c.createRadialGradient(0, 0, 2, 0, 0, 26);
    grd.addColorStop(0, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grd;
    c.fill();
    c.restore();

    // entities
    for (const e of entities) {
      if (!e.alive || e === player) continue;
      const ex = px(e.pos.x), ez = pz(e.pos.z);
      if (ex < 4 || ez < 4 || ex > this.size - 4 || ez > this.size - 4) {
        // clamp to the edge so you still see the direction of a distant team mate
        const ang = Math.atan2(ez - half, ex - half);
        const r = half - 8;
        drawBlip(c, half + Math.cos(ang) * r, half + Math.sin(ang) * r, e, 0.5, true);
        continue;
      }
      const friendly = !game.isHostile(player, e);
      const visible = friendly || game.canSee(player, e);
      drawBlip(c, ex, ez, e, visible ? 1 : 0.35, false, this.pulse);
    }

    // player arrow
    c.save();
    c.translate(half, half);
    c.rotate(-player.yaw + Math.PI);
    c.fillStyle = '#f8f8f2';
    c.beginPath();
    c.moveTo(0, -7); c.lineTo(5.5, 6); c.lineTo(0, 3.2); c.lineTo(-5.5, 6);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 1;
    c.stroke();
    c.restore();

    // edge darkening + frame
    const vg = c.createRadialGradient(half, half, this.size * 0.3, half, half, this.size * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = vg;
    c.fillRect(0, 0, this.size, this.size);
    c.restore();
  }
}

function drawBlip(c, x, y, e, alpha, edge, pulse = 0) {
  const hostile = e.team === 'bravo';
  const col = hostile ? '#f87171' : '#4ade80';
  c.save();
  c.globalAlpha = alpha;
  c.translate(x, y);
  if (e.isBot) c.rotate(-(e.yaw || 0) + Math.PI);
  c.fillStyle = col;
  c.beginPath();
  if (hostile) {
    c.arc(0, 0, 3.4, 0, 7);
  } else {
    c.moveTo(0, -3.6); c.lineTo(3.2, 3.2); c.lineTo(0, 1.6); c.lineTo(-3.2, 3.2);
    c.closePath();
  }
  c.fill();
  if (edge) { c.strokeStyle = col; c.lineWidth = 1.4; c.stroke(); }
  c.restore();
}
