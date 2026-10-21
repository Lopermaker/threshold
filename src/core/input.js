// Keyboard and mouse state with per-frame edge detection.

export class Input {
  constructor(canvas) {
    this.down = new Set();
    this.pressed = new Set();
    this.mouse = { x:0, y:0, buttons:[false, false, false] };
    this.clicks = [];
    this.wheel = 0;
    this.typed = [];

    addEventListener('keydown', e => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      this.typed.push(e.key);
    });
    addEventListener('keyup', e => this.down.delete(e.code));
    addEventListener('blur', () => {
      this.down.clear();
      this.mouse.buttons = [false, false, false];
    });

    const pos = e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    };
    canvas.addEventListener('pointerdown', e => {
      pos(e);
      this.mouse.buttons[e.button] = true;
      this.clicks.push({ x:this.mouse.x, y:this.mouse.y, button:e.button });
    });
    addEventListener('pointerup', e => { this.mouse.buttons[e.button] = false; });
    addEventListener('pointermove', pos);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive:false });
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.clicks.length = 0;
    this.typed.length = 0;
    this.wheel = 0;
  }
}
