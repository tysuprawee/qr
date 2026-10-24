import createElement from 'lucide/dist/esm/createElement.js';
import { icons } from './icons.js';
export const icon = (name, cls = '') => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
export const escape = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
export const $ = (selector, root = document) => root.querySelector(selector);
export function refreshIcons() {
  document.querySelectorAll('i[data-lucide]').forEach(placeholder => {
    const name = placeholder.dataset.lucide, definition = icons[name]; if (!definition) return;
    const svg = createElement(definition); svg.setAttribute('class', `lucide lucide-${name} ${placeholder.className}`); svg.setAttribute('stroke-width', '1.65'); svg.setAttribute('aria-hidden', 'true'); placeholder.replaceWith(svg);
  });
}
export function toast(message, bad = false) {
  let box = $('#toast'); if (!box) { box = document.createElement('div'); box.id = 'toast'; box.setAttribute('role', 'status'); document.body.append(box); }
  box.textContent = message; box.className = bad ? 'visible error' : 'visible'; clearTimeout(toast.timer); toast.timer = setTimeout(() => box.className = '', 5500);
}
export function modal(title, content, className = '') {
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog'); dialog.className = `modal ${className}`;
  dialog.innerHTML = `<div class="modal-head"><h2>${escape(title)}</h2><button class="icon-button close-modal" aria-label="Close dialog">${icon('x')}</button></div>${content}`;
  document.body.append(dialog); dialog.showModal(); refreshIcons();
  const close = () => { dialog.close(); dialog.remove(); dialog.onCleanup?.(); previousFocus?.focus(); };
  $('.close-modal', dialog).onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => { if (event.target === dialog && (event.clientX < dialog.getBoundingClientRect().left || event.clientX > dialog.getBoundingClientRect().right || event.clientY < dialog.getBoundingClientRect().top || event.clientY > dialog.getBoundingClientRect().bottom)) close(); });
  return { dialog, close };
}
export function download(data, name, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function guarded(fn) { try { await fn(); } catch (e) { toast(e.message, true); } }
