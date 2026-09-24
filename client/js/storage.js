export const storage = {
  get: (key) => localStorage.getItem('note:' + key),
  set: (key, value) => localStorage.setItem('note:' + key, value),
  remove: (key) => localStorage.removeItem('note:' + key),
};

export function getAllNoteKeys() {
  return Object.keys(localStorage)
    .filter(k => k.startsWith('note:'))
    .map(k => k.slice(5));
}
