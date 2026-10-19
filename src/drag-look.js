const DRAG_THRESHOLD = 9;

export class DragLook {
  constructor(canvas, { canDrag, onReset }) {
    Object.assign(this, { canvas, canDrag, onReset, yaw: 0, pitch: 0, pointer: null, lastTap: null });
    canvas.addEventListener("pointerdown", (event) => this.begin(event));
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("lostpointercapture", (event) => {
      if (this.pointer === event.pointerId) this.cancel();
    });
    window.addEventListener("pointerup", (event) => this.end(event), true);
    window.addEventListener("pointercancel", (event) => {
      if (this.pointer === event.pointerId) this.cancel();
    }, true);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    // Native dblclick can follow two swipes in Safari. Only two stationary
    // pointer gestures below qualify for resetting the camera.
    canvas.addEventListener("dblclick", (event) => event.preventDefault());
    window.addEventListener("blur", () => this.cancel());
  }

  begin(event, capture = true) {
    if (event.button !== 0 || this.pointer !== null || !this.canDrag()) return false;
    event.preventDefault?.();
    this.pointer = event.pointerId;
    this.x = this.startX = event.clientX;
    this.y = this.startY = event.clientY;
    this.started = performance.now();
    this.moved = false;
    if (capture) {
      try { this.canvas.setPointerCapture(event.pointerId); } catch {
        /* Global release handlers cover interrupted Safari touches. */
      }
    }
    this.canvas.classList.add("is-dragging");
    return true;
  }

  move(event) {
    if (this.pointer !== event.pointerId) return;
    if ((event.pointerType === "mouse" && !(event.buttons & 1)) || !this.canDrag()) return this.cancel();
    if (Math.hypot(event.clientX - this.startX, event.clientY - this.startY) >= DRAG_THRESHOLD) {
      this.moved = true;
      this.lastTap = null;
    }
    this.yaw -= (event.clientX - this.x) * 0.005;
    this.pitch = Math.max(-1.15, Math.min(1.15, this.pitch + (event.clientY - this.y) * 0.004));
    this.x = event.clientX;
    this.y = event.clientY;
  }

  end(event) {
    if (this.pointer !== event.pointerId) return;
    const now = performance.now();
    const tap = !this.moved && Math.hypot(event.clientX - this.startX, event.clientY - this.startY) < DRAG_THRESHOLD && now - this.started < 350 && this.canDrag();
    const previous = this.lastTap;
    this.cancel();
    if (!tap) return;
    if (previous && now - previous.time < 350 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 24) {
      this.reset();
      this.onReset();
    } else this.lastTap = { x: event.clientX, y: event.clientY, time: now };
  }

  cancel() {
    const pointer = this.pointer;
    this.pointer = null;
    this.lastTap = null;
    this.canvas.classList.remove("is-dragging");
    try {
      if (pointer !== null && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    } catch { /* Safari may already have cancelled it. */ }
  }

  reset() {
    this.cancel();
    this.yaw = this.pitch = 0;
  }
}
