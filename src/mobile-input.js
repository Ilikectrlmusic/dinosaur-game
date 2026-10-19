export class MobileInput {
  constructor(container, { canUse, onJump, onDuck }) {
    this.pointers = new Map();
    this.onDuck = onDuck;
    this.container = container;
    for (const button of container.querySelectorAll("button")) {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (event.button !== 0 || !canUse()) return;
        this.pointers.set(event.pointerId, button);
        button.classList.add("is-held");
        try {
          button.setPointerCapture(event.pointerId);
        } catch {
          /* Global release handlers cover interrupted Safari touches. */
        }
        if (button.id === "touch-jump") onJump();
        else onDuck(true);
      });
      button.addEventListener("lostpointercapture", (event) =>
        this.release(event.pointerId),
      );
    }
    for (const type of ["pointerup", "pointercancel"]) {
      window.addEventListener(
        type,
        (event) => this.release(event.pointerId),
        true,
      );
    }
    for (const type of [
      "touchstart",
      "touchmove",
      "contextmenu",
      "selectstart",
      "dragstart",
    ]) {
      container.addEventListener(type, (event) => event.preventDefault(), {
        passive: false,
      });
    }
    for (const type of ["touchend", "touchcancel"]) {
      window.addEventListener(
        type,
        (event) => {
          if (!event.touches.length || type === "touchcancel") this.reset();
        },
        { passive: true },
      );
    }
    window.addEventListener("blur", () => this.reset());
  }

  release(id) {
    const button = this.pointers.get(id);
    if (!button) return;
    this.pointers.delete(id);
    button.classList.remove("is-held");
    try {
      if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    } catch {
      /* A cancelled pointer may already have been released by Safari. */
    }
    if (button.id === "touch-duck") this.onDuck(false);
  }

  reset() {
    for (const id of [...this.pointers.keys()]) this.release(id);
    this.onDuck(false);
  }
}
