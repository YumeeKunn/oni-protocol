// ═══════════════ INPUT — keyboard / mouse / pointer lock ═══════════════

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.justPressed = new Set();
    this.justReleased = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0 };
    this.mouseDown = { left: false, right: false };
    this.mouseUp = { left: false, right: false };
    this.locked = false;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.enabled = false;
    this._handlers = { keydown: [], keyup: [], lockchange: [] };
    this._bind();
  }

  on(type, fn) { (this._handlers[type] ||= []).push(fn); }
  _emit(type, e) { for (const fn of this._handlers[type] || []) fn(e); }

  _bind() {
    addEventListener('keydown', e => {
      if (e.repeat) { this._emit('keydown', e); return; }
      if (!this.keys[e.code]) this.justPressed.add(e.code);
      this.keys[e.code] = true;
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Tab', 'F4'].includes(e.code)) e.preventDefault();
      this._emit('keydown', e);
    });
    addEventListener('keyup', e => {
      this.keys[e.code] = false;
      this.justReleased.add(e.code);
      this._emit('keyup', e);
    });
    addEventListener('blur', () => { this.keys = Object.create(null); this.mouse.left = this.mouse.right = false; });

    this.canvas.addEventListener('mousedown', e => {
      if (e.button === 0) { if (!this.mouse.left) this.mouseDown.left = true; this.mouse.left = true; }
      if (e.button === 2) { if (!this.mouse.right) this.mouseDown.right = true; this.mouse.right = true; }
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) { this.mouse.left = false; this.mouseUp.left = true; }
      if (e.button === 2) { this.mouse.right = false; this.mouseUp.right = true; }
    });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });

    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this._emit('lockchange', this.locked);
    });
  }

  requestLock() {
    const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(...codes) { return codes.some(c => this.keys[c]); }
  pressed(...codes) { return codes.some(c => this.justPressed.has(c)); }
  released(...codes) { return codes.some(c => this.justReleased.has(c)); }

  /** clear edge state — call once at the end of every frame */
  endFrame() {
    this.justPressed.clear();
    this.justReleased.clear();
    this.mouseDown.left = this.mouseDown.right = false;
    this.mouseUp.left = this.mouseUp.right = false;
  }

  /** a convenience input facade for gameplay code */
  get fire() { return this.mouse.left; }
  get right() { return this.mouse.right; }

  // consume accumulated look delta (call once per frame)
  consumeLook() {
    const d = { x: this.mouse.dx, y: this.mouse.dy };
    this.mouse.dx = 0; this.mouse.dy = 0;
    return d;
  }
  /** read the frame's accumulated look delta without clearing it (camera sway etc.) */
  peekLook() { return { x: this.mouse.dx, y: this.mouse.dy }; }
  consumeWheel() { const w = this.mouse.wheel; this.mouse.wheel = 0; return w; }
}
