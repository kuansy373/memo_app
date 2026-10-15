import { API_BASE } from './constants.js';
import { storage } from './storage.js';
import { renderDiff } from './diff.js';
import {
  currentMode, setCurrentMode,
  preDiffMode, setPreDiffMode,
  lastSyncedMap, pullNotes,
} from './state.js';
import { currentNote } from './navigation.js';

// ----------------------------------------
// 初期化
// ----------------------------------------

let _editor, _preview, _update, _applyModeClass, _updateModeLabel, _setVisible;
export function initSync({ editor, preview, update, applyModeClass, updateModeLabel, setVisible }) {
  _editor = editor;
  _preview = preview;
  _update = update;
  _applyModeClass = applyModeClass;
  _updateModeLabel = updateModeLabel;
  _setVisible = setVisible;
}

// ----------------------------------------
// 認証状態チェック
// ----------------------------------------

export let isLoggedIn = false;
export let isAuthChecking = true;

export async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth/status`, { credentials: 'include' });
    const { loggedIn } = await res.json();
    isLoggedIn = loggedIn;
  } catch (e) {
    isLoggedIn = false;
  } finally {
    isAuthChecking = false;
  }
}

// ----------------------------------------
// Push / Pull
// ----------------------------------------

export function checkPushStatus() {
  const toggleBtn = document.querySelector('.btn-toggle');

  if (isAuthChecking) {
    toggleBtn.style.display = 'none';
    return;
  }

  if (!isLoggedIn) {
    toggleBtn.style.display = 'inline';
    _setVisible('push-btn', false);
    _setVisible('push-diff-btn', false);
    _setVisible('pull-btn', false);
    _setVisible('pull-diff-btn', false);
    return;
  }

  if (pullNotes.has(currentNote)) {
    toggleBtn.style.display = 'none';
    _setVisible('pull-btn', true);
    _setVisible('pull-diff-btn', true);
    _setVisible('push-btn', false);
    _setVisible('push-diff-btn', false);
    return;
  }

  const lastSynced = lastSyncedMap.get(currentNote);
  if (lastSynced === undefined) {
    toggleBtn.style.display = 'none';
    _setVisible('push-btn', false);
    _setVisible('push-diff-btn', false);
    _setVisible('pull-diff-btn', false);
    return;
  }

  toggleBtn.style.display = 'inline';

  const needsPush = _editor.value !== lastSynced;
  _setVisible('push-btn', needsPush);
  _setVisible('push-diff-btn', needsPush);
  _setVisible('pull-btn', false);
  _setVisible('pull-diff-btn', false);
}

export async function checkCurrentNote() {
  if (!isLoggedIn) return;
  const note = currentNote;

  if (pullNotes.has(note)) {
    checkPushStatus();
    return;
  }
  if (lastSyncedMap.has(note)) {
    checkPushStatus();
    return;
  }

  try {
    const localContent = storage.get(note);
    const res = await fetch(`${API_BASE}/api/notes${note}`, { credentials: 'include' });

    if (note !== currentNote) return;
    if (!res.ok && res.status !== 404) return;
    if (res.status === 404) {
      lastSyncedMap.set(note, '');
      checkPushStatus();
      return;
    }

    const { content: serverContent } = await res.json();
    lastSyncedMap.set(note, serverContent);

    if (serverContent !== localContent) {
      pullNotes.add(note);
    }
    checkPushStatus();
  } catch (e) {}
}

export async function pullCurrentNote() {
  const note = currentNote;
  const wasDiff = currentMode === 'diff';
  try {
    const res = await fetch(`${API_BASE}/api/notes${note}`, { credentials: 'include' });
    if (!res.ok) return;
    const { content } = await res.json();
    storage.set(note, content);
    lastSyncedMap.set(note, content);
    if (note === currentNote) {
      _setVisible('cancel-pull-btn', false);
      _editor.value = content;
      if (wasDiff) {
        setCurrentMode('preview');
        _applyModeClass();
        _update();
        _updateModeLabel();
      } else {
        _update();
      }
    }
    pullNotes.delete(note);
    if (note === currentNote) {
      checkPushStatus();
    }
  } catch (e) {}
}

export async function push() {
  const note = currentNote;
  const wasDiff = currentMode === 'diff';
  const content = storage.get(note) ?? '';
  await fetch(`${API_BASE}/api/notes${note}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    credentials: 'include'
  });
  lastSyncedMap.set(note, content);
  if (note === currentNote) {
    if (wasDiff) {
      setCurrentMode('preview');
      _applyModeClass();
      _update();
      _updateModeLabel();
    }
    checkPushStatus();
  }
}

// ----------------------------------------
// Diff 表示
// ----------------------------------------

export function enterDiff(oldText, newText) {
  setPreDiffMode(currentMode);
  _preview.innerHTML = renderDiff(oldText, newText);
  setCurrentMode('diff');
  _applyModeClass();
  _updateModeLabel();
}

export function exitDiff() {
  setCurrentMode(preDiffMode);
  _applyModeClass();
  if (currentMode === 'preview') _update();
  _updateModeLabel();
  checkPushStatus();
}

export function showPushDiff() {
  if (currentMode === 'diff') {
    exitDiff();
    return;
  }
  const local = _editor.value;
  const server = lastSyncedMap.get(currentNote) ?? '';
  enterDiff(server, local);
}

export function cancelPull() {
  pullNotes.delete(currentNote);
  _setVisible('cancel-pull-btn', false);
  const local = _editor.value;
  _preview.innerHTML = renderDiff(local, local);
  checkPushStatus();
}

export async function showPullDiff() {
  if (currentMode === 'diff') {
    exitDiff();
    _setVisible('cancel-pull-btn', false);
    return;
  }
  const local = _editor.value;
  try {
    const res = await fetch(`${API_BASE}/api/notes${currentNote}`, { credentials: 'include' });
    if (!res.ok) return;
    const { content: server } = await res.json();
    enterDiff(local, server);
    _setVisible('cancel-pull-btn', true);
  } catch (e) {}
}
