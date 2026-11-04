import "@testing-library/jest-dom/vitest";

// jsdom has no <dialog> behaviour: give it the two methods the Modal uses (open state only; the browser provides focus trapping, tests cover our own logic).
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
}
