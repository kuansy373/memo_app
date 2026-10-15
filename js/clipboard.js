import { COPY_ICON } from './svg.js';

export function copyCode(btn) {
  const code = btn.nextElementSibling.querySelector('code').textContent;
  navigator.clipboard.writeText(code).catch(() => {});

  if (btn._copyTimer) clearTimeout(btn._copyTimer);

  btn.innerHTML = '✓';
  btn.classList.add('copied');

  btn._copyTimer = setTimeout(() => {
    btn.innerHTML = COPY_ICON;
    btn.classList.remove('copied');
    btn._copyTimer = null;
  }, 2000);
}
