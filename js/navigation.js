import { APP_BASE, API_BASE } from './constants.js';
import { storage, getAllNoteKeys } from './storage.js';
import { parseAliases } from './parser.js';

export let initialNoteKey = localStorage.getItem('system_initial_note') || `${APP_BASE}initial`;
export let currentNote = initialNoteKey;
export let breadcrumbs = [];

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

export function switchNote(path) {
  const fullPath = path.startsWith(APP_BASE) ? path : `${APP_BASE}${path}`;
  currentNote = fullPath;
  breadcrumbs = parsePathToCrumbs(fullPath);
  const content = storage.get(fullPath) || '';
  return { path: fullPath, content, breadcrumbs };
}

export function navigateToIndex(index) {
  breadcrumbs = breadcrumbs.slice(0, index + 1);
  return switchNote(breadcrumbs[index].path);
}

export function pushBreadcrumbsToURL(crumbs) {
  const newPath = crumbs.length > 0 ? crumbs[crumbs.length - 1].path : APP_BASE.slice(0, -1);
  if (location.pathname !== newPath) {
    history.pushState(null, '', newPath);
  }
}

export async function renameNote(oldPath, currentEditorValue) {
  const lastSlashIndex = oldPath.lastIndexOf('/');
  if (lastSlashIndex === -1) return null;

  const parentPath = oldPath.slice(0, lastSlashIndex);
  const oldName = oldPath.slice(lastSlashIndex + 1);

  const newName = prompt('名前を変更', oldName);
  if (newName === null) return null;

  const trimmedNewName = newName.trim();
  if (!trimmedNewName || trimmedNewName === oldName) return null;

  const newPath = `${parentPath}/${trimmedNewName}`;

  const conflict = getAllNoteKeys().some(key =>
    key === newPath || key.startsWith(newPath + '/')
  );
  if (conflict) {
    alert(`すでに指定先の位置にノートが存在します: ${newPath}`);
    return null;
  }

  storage.set(oldPath, currentEditorValue);

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

  if (oldPath === initialNoteKey) {
    initialNoteKey = newPath;
    localStorage.setItem('system_initial_note', newPath);
  }

  try {
    await fetch(`${API_BASE}/api/notes/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath }),
      credentials: 'include',
    });
  } catch (e) {
    // オフライン時などは無視（次回 push 時に上書きされる）
  }

  return newPath;
}

// ----------------------------------------
// スクロール位置
// ----------------------------------------

const scrollPositions = new Map();

export function saveScrollPosition(path, scrollTop) {
  scrollPositions.set(path, scrollTop);
}

export function getScrollPosition(path) {
  return scrollPositions.get(path) ?? 0;
}
