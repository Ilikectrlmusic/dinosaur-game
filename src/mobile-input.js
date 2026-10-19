export class MobileInput {
  constructor(container, { canUse, onJump, onDuck, onLookStart, onLookMove, onLookEnd }) {
    Object.assign(this, { container, canUse, onJump, onDuck, onLookStart, onLookMove, onLookEnd });
    this.pointers = new Map();
    for (const button of container.querySelectorAll("button")) {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (event.button !== 0 || !canUse()) return;
        const touch = {
          button, mode: "pending", x: event.clientX, y: event.clientY,
          start: { pointerId: event.pointerId, pointerType: event.pointerType, button: 0, clientX: event.clientX, clientY: event.clientY },
        };
        this.pointers.set(event.pointerId, touch);
        try { button.setPointerCapture(event.pointerId); } catch {
          /* Global release handlers cover interrupted Safari touches. */
        }
        // The visible circles are immediate controls. In their larger invisible
        // regions, a tap jumps, a stationary hold ducks, and movement orbits.
        if (event.target.closest(".touch-icon")) this.activate(touch);
        else if (button.id === "touch-duck") touch.timer = setTimeout(() => {
          if (this.pointers.get(event.pointerId) === touch && touch.mode === "pending" && canUse()) this.activate(touch);
        }, 120);
      });
      button.addEventListener("pointermove", (event) => {
        const touch = this.pointers.get(event.pointerId);
        if (!touch || !canUse()) return;
        if (touch.mode === "pending" && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) >= 9) {
          clearTimeout(touch.timer);
          touch.mode = this.onLookStart?.(touch.start) ? "look" : "cancelled";
        }
        if (touch.mode === "look") this.onLookMove?.(event);
      });
      button.addEventListener("lostpointercapture", (event) => this.release(event.pointerId));
    }
    window.addEventListener("pointerup", (event) => {
      const touch = this.pointers.get(event.pointerId);
      if (touch?.mode === "pending" && canUse() && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) < 9) this.activate(touch);
      this.release(event.pointerId);
    }, true);
    window.addEventListener("pointercancel", (event) => this.release(event.pointerId), true);
    for (const type of ["touchstart", "touchmove", "contextmenu", "selectstart", "dragstart"]) {
      container.addEventListener(type, (event) => event.preventDefault(), { passive: false });
    }
    for (const type of ["touchend", "touchcancel"]) {
      window.addEventListener(type, (event) => {
        if (!event.touches.length || type === "touchcancel") this.reset();
      }, { passive: true });
    }
    window.addEventListener("blur", () => this.reset());
  }

  activate(touch) {
    touch.mode = "control";
    touch.button.classList.add("is-held");
    if (touch.button.id === "touch-jump") this.onJump();
    else this.onDuck(true);
  }

  release(id) {
    const touch = this.pointers.get(id);
    if (!touch) return;
    this.pointers.delete(id);
    clearTimeout(touch.timer);
    const { button } = touch;
    const stillHeld = [...this.pointers.values()].some((other) => other.button === button && other.mode === "control");
    if (!stillHeld) button.classList.remove("is-held");
    if (touch.mode === "look") this.onLookEnd?.();
    try {
      if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    } catch { /* Safari may already have cancelled it. */ }
    if (button.id === "touch-duck" && touch.mode === "control" && !stillHeld) this.onDuck(false);
  }

  reset() {
    for (const id of [...this.pointers.keys()]) this.release(id);
    this.onDuck(false);
  }
}
