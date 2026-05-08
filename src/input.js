// Keyboard and mouse input handler — single source of truth for raw input state

export class InputHandler {
  constructor() {
    this.keys = {};
    this._dx = 0;
    this._dy = 0;
    // Keys that fire a one-shot "just pressed" event this frame
    this._justPressed = new Set();
    this._prevKeys = {};

    this.shift = false;

    window.addEventListener('keydown', e => {
      if (!this.keys[e.code]) this._justPressed.add(e.code);
      this.keys[e.code] = true;
      if (e.shiftKey) this.shift = true;
      // Prevent browser scroll on space / arrow keys
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.shift = false;
    });

    // Only accumulate mouse delta while pointer is locked
    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement) {
        this._dx += e.movementX;
        this._dy += e.movementY;
      }
    });
  }

  /** True while the key is held */
  isDown(code) { return !!this.keys[code]; }

  /** True only on the first frame the key was pressed */
  justPressed(code) { return this._justPressed.has(code); }

  /** Consume and return accumulated mouse delta since last call */
  consumeMouseDelta() {
    const dx = this._dx, dy = this._dy;
    this._dx = 0; this._dy = 0;
    return { dx, dy };
  }

  /** Call once per frame at the END of the update, after all justPressed checks */
  endFrame() {
    this._justPressed.clear();
  }
}
