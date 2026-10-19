// Capture gestures on the canvas only, so menus and dialogs keep normal clicks.
export class DragLook {
  constructor(canvas, { canDrag, onReset }) {
    this.canvas = canvas;
    this.yaw = 0;
    this.pitch = 0;
    this.pointer = null;
    this.canDrag = canDrag;
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.pointer !== null || !canDrag()) return;
      event.preventDefault();
      this.pointer = event.pointerId;
      this.x = event.clientX;
      this.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.pointer !== event.pointerId) return;
      if (!canDrag()) return this.cancel();
      this.yaw -= (event.clientX - this.x) * 0.005;
      this.pitch = Math.max(
        -1.15,
        Math.min(1.15, this.pitch + (event.clientY - this.y) * 0.004),
      );
      this.x = event.clientX;
      this.y = event.clientY;
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      canvas.addEventListener(type, (event) => {
        if (this.pointer === event.pointerId) this.cancel();
      });
    }
    canvas.addEventListener("dblclick", () => {
      if (!canDrag()) return;
      this.reset();
      onReset();
    });
    window.addEventListener("blur", () => this.cancel());
  }

  cancel() {
    const pointer = this.pointer;
    this.pointer = null;
    this.canvas.classList.remove("is-dragging");
    if (pointer !== null && this.canvas.hasPointerCapture(pointer)) {
      this.canvas.releasePointerCapture(pointer);
    }
  }

  reset() {
    this.cancel();
    this.yaw = 0;
    this.pitch = 0;
  }
}
