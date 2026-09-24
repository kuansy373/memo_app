import { APP_BASE } from './constants.js';
import { storage, getAllNoteKeys } from './storage.js';
import { parseAliases } from './parser.js';

export let rootNoteKey = localStorage.getItem('system_root_key') || `${APP_BASE}root`;
export let currentNote = rootNoteKey;
export let breadcrumbs = [];

// ui.js から注入される依存関数
let _editor;
let _update;
let _ensurePreview;
let _checkCurrentNote;
let _checkPushStatus;

export function initNavigation(editor, update, ensurePreview, checkCurrentNote, checkPushStatus) {
  _editor = editor;
  _update = update;
  _ensurePreview = ensurePreview;
  _checkCurrentNote = checkCurrentNote;
  _checkPushStatus = checkPushStatus;
}

export function parsePathToCrumbs(fullPath) {
  if (!fullPath.startsWith(APP_BASE)) {
    return [{ name: fullPath, path: fullPath }];
  }
  const rest = fullPath.slice(APP_BASE.length);
  const segments = rest.split('/').map(s => decodeURIComponent(s)).filter(Boolean);

  let currentAccumulated = APP_BASE.slice(0, -1);
  return segments.map(seg => {
    currentAccumulated += '/' + seg;
    return { name: seg, path: currentAccumulated };
  });
}

export function switchNote(path, { save = true } = {}) {
  const fullPath = path.startsWith(APP_BASE) ? path : `${APP_BASE}${path}`;

  if (save) storage.set(currentNote, _editor.value);

  currentNote = fullPath;
  breadcrumbs = parsePathToCrumbs(fullPath);
  const loadedContent = storage.get(fullPath) || '';
  _editor.value = loadedContent;
  updateBreadcrumbs();
  _update();
  _ensurePreview();
  _checkCurrentNote();
}

export function navigateToIndex(index) {
  breadcrumbs = breadcrumbs.slice(0, index + 1);
  switchNote(breadcrumbs[index].path);
}

export function updateBreadcrumbs() {
  const header = document.querySelector('header strong');

  header.innerHTML = breadcrumbs.map((crumb, index) => {
    if (index === breadcrumbs.length - 1) {
      return `<span>${crumb.name}</span>`;
    }
    return `<a href="#" onclick="navigateToIndex(${index}); return false;">${crumb.name}</a>`;
  }).join(' &gt; ');

  document.getElementById('rename-btn').onclick = () => {
    renameNote(breadcrumbs[breadcrumbs.length - 1].path);
  };

  pushBreadcrumbsToURL(breadcrumbs);
}

export function pushBreadcrumbsToURL(crumbs) {
  const newPath = crumbs.length > 0 ? crumbs[crumbs.length - 1].path : APP_BASE.slice(0, -1);
  if (location.pathname !== newPath) {
    history.pushState(null, '', newPath);
  }
}

export function renameNote(oldPath) {
  const lastSlashIndex = oldPath.lastIndexOf('/');
  if (lastSlashIndex === -1) return;

  const parentPath = oldPath.slice(0, lastSlashIndex);
  const oldName = oldPath.slice(lastSlashIndex + 1);

  const newName = prompt('名前を変更', oldName);
  if (newName === null) return;

  const trimmedNewName = newName.trim();
  if (!trimmedNewName || trimmedNewName === oldName) return;

  const newPath = `${parentPath}/${trimmedNewName}`;

  const conflict = getAllNoteKeys().some(key =>
    key === newPath || key.startsWith(newPath + '/')
  );
  if (conflict) {
    alert(`すでに指定先の位置にノートが存在します: ${newPath}`);
    return;
  }

  storage.set(oldPath, _editor.value);

  const allKeys = getAllNoteKeys();

  allKeys.forEach(key => {
    const body = storage.get(key);
    if (!body) return;

    let updated = body;

    if (updated.includes(oldPath)) {
      updated = updated.replaceAll(oldPath, newPath);
    }

    const aliasMap = parseAliases(body);
    for (const [aliasName, aliasValue] of Object.entries(aliasMap)) {
      if (!oldPath.startsWith(aliasValue)) continue;
      const oldSuffix = oldPath.slice(aliasValue.length);
      if (!oldSuffix) continue;
      const oldAliased = aliasName + ':' + oldSuffix;
      const newAliased = aliasName + ':' + newPath.slice(aliasValue.length);
      if (updated.includes(oldAliased)) {
        updated = updated.replaceAll(oldAliased, newAliased);
      }
    }

    if (updated !== body) {
      storage.set(key, updated);
    }
  });

  allKeys
    .filter(key => key === oldPath || key.startsWith(oldPath + '/'))
    .forEach(key => {
      const targetPath = newPath + key.slice(oldPath.length);
      storage.set(targetPath, storage.get(key));
      storage.remove(key);
    });

  if (oldPath === rootNoteKey) {
    rootNoteKey = newPath;
    localStorage.setItem('system_root_key', newPath);
  }

  switchNote(newPath, { save: false });
}
