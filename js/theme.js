export function applyTheme(theme) {
  const lightLink = document.getElementById('hljs-light');
  const darkLink  = document.getElementById('hljs-dark');
  const resolved =
    theme === 'light' ? 'light' :
    theme === 'dark'  ? 'dark'  :
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  document.documentElement.setAttribute('data-theme', resolved);
  lightLink.disabled = (resolved === 'dark');
  darkLink.disabled  = (resolved === 'light');
  localStorage.setItem('theme', theme);
}

export function syncThemeRadio(preview) {
  const saved = localStorage.getItem('theme') ?? 'system';
  preview.querySelectorAll('input[data-action="theme"]').forEach(radio => {
    radio.checked = (radio.value === saved);
  });
}
