// A regular DOM overlay avoids Safari's native-dialog/WebGL top-layer interaction.
export class DeathOverlay {
  constructor(element) {
    this.element = element;
    this.background = new Map();
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const buttons = [...element.querySelectorAll("button:not(:disabled)")];
      const next = event.shiftKey ? buttons.at(-1) : buttons[0];
      if (
        !element.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === buttons[0]) ||
        (!event.shiftKey && document.activeElement === buttons.at(-1))
      ) {
        event.preventDefault();
        next?.focus();
      }
    });
  }

  get isOpen() {
    return !this.element.hidden;
  }

  open() {
    if (this.isOpen) return;
    this.previousFocus = document.activeElement;
    for (const node of document.body.children) {
      if (node === this.element || ["SCRIPT", "STYLE"].includes(node.tagName))
        continue;
      this.background.set(node, !!node.inert);
      node.inert = true;
    }
    this.element.hidden = false;
    document.body.classList.add("result-open");
    this.element.querySelector("button")?.focus({ preventScroll: true });
  }

  close() {
    this.element.hidden = true;
    document.body.classList.remove("result-open");
    for (const [node, wasInert] of this.background) node.inert = wasInert;
    this.background.clear();
    if (
      this.previousFocus?.isConnected &&
      this.previousFocus.getClientRects().length
    ) {
      this.previousFocus.focus({ preventScroll: true });
    }
    this.previousFocus = null;
  }
}
