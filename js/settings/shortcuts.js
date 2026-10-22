// ショートカットキー
const SHORTCUT_DEFAULTS = {
  togglePane: 'Ctrl+E',
};

function getShortcut(name) {
  return localStorage.getItem(`settings:shortcuts:${name}`) ?? SHORTCUT_DEFAULTS[name];
}

export function saveShortcut(name, value) {
  localStorage.setItem(`settings:shortcuts:${name}`, value);
}

export function keyEventToString(e) {
  const parts = [];
  if (e.ctrlKey)  parts.push('Ctrl');
  if (e.altKey)   parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey)  parts.push('Meta');
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  return parts.join('+');
}

export function clearShortcut(name) {
  localStorage.setItem(`settings:shortcuts:${name}`, '');
}

export function matchesShortcut(e, name) {
  const shortcut = getShortcut(name);
  if (!shortcut) return false;
  return keyEventToString(e) === shortcut;
}

export function syncShortcutUI(preview) {
  preview.querySelectorAll('.shortcut-setting[data-shortcut]').forEach(el => {
    const name = el.dataset.shortcut;
    const input = el.querySelector('.shortcut-input');
    input.value = getShortcut(name) ?? '';
  });
}
