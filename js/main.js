import { APP_BASE, API_BASE } from './constants.js';
import { storage } from './storage.js';
import { parseCustomMarkdown } from './parser.js';
import { applyTheme, syncThemeRadio } from './theme.js';
import { copyCode } from './clipboard.js';
import { handleInInput } from './inout.js';
import { initNotes } from './initNotes.js';
import { currentMode, setCurrentMode, pullNotes } from './state.js';
import {
  rootNoteKey, currentNote,
  switchNote, navigateToIndex,
  pushBreadcrumbsToURL, renameNote,
} from './navigation.js';
import {
  isLoggedIn,
  checkAuth, checkPushStatus, checkCurrentNote,
  push, pullCurrentNote,
  exitDiff,
  showPushDiff, showPullDiff, cancelPull,
  initSync,
} from './sync.js';

// ----------------------------------------
// DOM
// ----------------------------------------

const editor = document.getElementById('editor');
const preview = document.getElementById('preview');

// ----------------------------------------
// Preview
// ----------------------------------------

function update() {
  preview.innerHTML = parseCustomMarkdown(editor.value);
  syncThemeRadio(preview);
}

// ----------------------------------------
// Preview イベント委譲
// ----------------------------------------

// @masks: 行クリックで行全体をトグル表示
// masks-cell 内のリンク・画像クリックも行トグルに伝播させる
// ※ 行リスナーとの組み合わせ（バブリングによる重複を含む）は CSS と合わせて意図した挙動。変更しないこと。
preview.addEventListener('click', e => {
  const row = e.target.closest('.masks-row');
  if (!row) return;
  // リンク・画像からのバブリングも含め、常に行全体をトグル
  row.classList.toggle('revealed');
});

// @hide: hide-col セル自体をクリックでトグル（行位置を維持）
preview.addEventListener('click', e => {
  const cell = e.target.closest('.hide-col');
  if (!cell) return;
  if (window.getSelection().toString().length > 0) return;
  const colClass = [...cell.classList].find(c => c.startsWith('hide-col-'));
  if (!colClass) return;
  const row = cell.closest('tr');
  const rowTop = row.getBoundingClientRect().top;
  const table = cell.closest('table');
  table.querySelectorAll(`.${colClass}`).forEach(c => {
    c.classList.toggle('revealed');
  });
  const newRowTop = row.getBoundingClientRect().top;
  preview.scrollTop += newRowTop - rowTop;
});

// @mask: 列セルにホバーで列全体を表示、列から離れたら隠す
// テーブルごとに activeColClass を管理するため WeakMap を使用
const maskTableState = new WeakMap();

preview.addEventListener('mouseover', e => {
  const table = e.target.closest('table');
  if (!table) return;
  const cell = e.target.closest('td');
  const colClass = cell && [...cell.classList].find(c => c.startsWith('mask-col-'));
  const activeColClass = maskTableState.get(table) ?? null;

  if (colClass === activeColClass) return;

  // 前の列を隠す
  if (activeColClass) {
    table.querySelectorAll(`.${activeColClass}`).forEach(c => c.classList.remove('revealed'));
  }
  // 新しい列を表示
  if (colClass) {
    table.querySelectorAll(`.${colClass}`).forEach(c => c.classList.add('revealed'));
  }
  maskTableState.set(table, colClass || null);
});

preview.addEventListener('mouseleave', e => {
  const table = e.target.closest('table');
  if (!table) return;
  const activeColClass = maskTableState.get(table) ?? null;
  if (activeColClass) {
    table.querySelectorAll(`.${activeColClass}`).forEach(c => c.classList.remove('revealed'));
    maskTableState.set(table, null);
  }
}, true); // キャプチャフェーズで table の mouseleave を確実に拾う

// ----------------------------------------
// ヘルパー
// ----------------------------------------

function setVisible(id, visible) {
  document.getElementById(id).style.display = visible ? 'inline' : 'none';
}

function applyModeClass() {
  document.getElementById('app').className = 'mode-' + currentMode;
}

// editor の内容を現在のノートに保存する（空なら削除）
function saveCurrentNote() {
  if (editor.value === '') {
    storage.remove(currentNote);
  } else {
    storage.set(currentNote, editor.value);
  }
}

// ----------------------------------------
// ノート切り替え
// ----------------------------------------

function applyNoteSwitch(path) {
  const { content, breadcrumbs: newCrumbs } = switchNote(path);
  editor.value = content;
  renderBreadcrumbs(newCrumbs);
  update();
  ensurePreview();
  checkPushStatus();
  checkCurrentNote();
}

function applyNavigateToIndex(index) {
  const { content, breadcrumbs: newCrumbs } = navigateToIndex(index);
  editor.value = content;
  renderBreadcrumbs(newCrumbs);
  update();
  ensurePreview();
  checkPushStatus();
  checkCurrentNote();
}

// ----------------------------------------
// Breadcrumbs
// ----------------------------------------

function renderBreadcrumbs(crumbs) {
  const header = document.querySelector('header strong');

  header.innerHTML = crumbs.map((crumb, index) => {
    if (index === crumbs.length - 1) {
      return `<span>${crumb.name}</span>`;
    }
    return `<a href="${crumb.path}" data-crumb-index="${index}">${crumb.name}</a>`;
  }).join(' &gt; ');

  document.getElementById('rename-btn').onclick = () => {
    handleRename(crumbs[crumbs.length - 1].path);
  };

  pushBreadcrumbsToURL(crumbs);
}

async function handleRename(oldPath) {
  const newPath = await renameNote(oldPath, editor.value);
  if (newPath !== null) {
    applyNoteSwitch(newPath);
  }
}

document.querySelector('header').addEventListener('click', e => {
  const link = e.target.closest('a[data-crumb-index]');
  if (!link) return;
  e.preventDefault();
  applyNavigateToIndex(Number(link.dataset.crumbIndex));
});

// ----------------------------------------
// Mode toggle
// ----------------------------------------

function updateModeLabel() {
  document.getElementById('mode-label').textContent =
    currentMode === 'edit' ? '編集中' :
    currentMode === 'diff' ? '差分確認中' : 'プレビュー中';
}

function updateModeIcon() {
  document.querySelectorAll('.btn-icon').forEach(icon => {
    icon.classList.toggle('btn-icon--pen', currentMode === 'preview');
    icon.classList.toggle('btn-icon--book', currentMode === 'edit');
    icon.alt = currentMode === 'edit' ? 'プレビュー' : '編集';
  });
}

function ensurePreview() {
  if (currentMode === 'edit') togglePane();
  // diff モード中はそのまま維持
}

function togglePane() {
  if (currentMode === 'diff') {
    exitDiff(); // diff モード中はまず preDiffMode に戻し、
    setCurrentMode(currentMode === 'edit' ? 'preview' : 'edit'); // その後にトグル
    applyModeClass();
    updateModeLabel();
    updateModeIcon();
    if (currentMode === 'preview') update();
    return;
  }

  const nextMode = currentMode === 'edit' ? 'preview' : 'edit';
  if (nextMode === 'edit' && pullNotes.has(currentNote)) {
    return;
  }
  setCurrentMode(nextMode);
  applyModeClass();
  updateModeLabel();
  updateModeIcon();
  if (currentMode === 'preview') {
    update();
    checkPushStatus();
  }
}

// ----------------------------------------
// Init
// ----------------------------------------

initNotes(rootNoteKey);
initSync({ editor, preview, update, applyModeClass, updateModeLabel, setVisible });

// 起動時にテーマを適用
applyTheme(localStorage.getItem('theme') ?? 'system');
// システムテーマ変更を追跡
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem('theme') ?? 'system') === 'system') applyTheme('system');
});

function initFromURL() {
  const fullPath = decodeURIComponent(location.pathname);
  const isBase = fullPath === APP_BASE.slice(0, -1) || fullPath === APP_BASE;
  const path = (fullPath.startsWith(APP_BASE) && !isBase)
    ? fullPath
    : rootNoteKey;
  applyNoteSwitch(path);
}

// ----------------------------------------
// popstate
// ----------------------------------------

window.addEventListener('popstate', () => {
  const fullPath = decodeURIComponent(location.pathname);
  if (!fullPath.startsWith(APP_BASE.slice(0, -1))) return;
  applyNoteSwitch(fullPath);
});

// ----------------------------------------
// Event Listeners
// ----------------------------------------

editor.addEventListener('input', () => {
  saveCurrentNote();
  update();
});

editor.addEventListener('paste', e => {
  const text = e.clipboardData.getData('text');
  const base = `${location.origin}${APP_BASE}`;
  if (!text.startsWith(base)) return;

  e.preventDefault();
  const decoded = text
    .split('/')
    .map(s => { try { return decodeURIComponent(s); } catch { return s; } })
    .join('/');

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  editor.value = editor.value.slice(0, start) + decoded + editor.value.slice(end);
  editor.selectionStart = editor.selectionEnd = start + decoded.length;
  saveCurrentNote();
  update();
});

preview.addEventListener('click', e => {
  // 注意: copyCode はボタンの中身（innerHTML）を差し替えて e.target を DOM から外す。
  // e.target からの closest() は、副作用のある処理を呼ぶ前にすべて済ませておくこと。
  const copyBtn = e.target.closest('[data-action="copy"]');
  const wrapper = e.target.closest('.code-block-wrapper');
  const link = e.target.closest('a');

  // テーマ切り替えラジオ
  if (e.target.matches('input[data-action="theme"]')) {
    applyTheme(e.target.value);
    return;
  }

  // コピーボタン
  if (copyBtn) copyCode(copyBtn);

  // スマホ: コードブロックのタップでコピーボタン表示トグル（コピーボタン自体のタップは除く）
  if (!wrapper) {
    document.querySelectorAll('.code-block-wrapper.touch-active')
      .forEach(el => el.classList.remove('touch-active'));
  } else if (!copyBtn) {
    wrapper.classList.toggle('touch-active');
  }

  if (!link) return;

  // アプリ内ノートへのリンク
  if (link.dataset.notePath !== undefined) {
    e.preventDefault();
    applyNoteSwitch(link.dataset.notePath);
    return;
  }

  // ログイン/ログアウトリンクのインターセプト
  const href = link.getAttribute('href') || '';
  const loginURL = `${API_BASE}/auth/google`;
  const logoutURL = `${API_BASE}/auth/logout`;

  if (href === loginURL) {
    if (isLoggedIn) {
      e.preventDefault();
      alert('すでにログイン済みです。\nアカウントを切り替えるには一度ログアウトしてください。');
    }
  } else if (href === logoutURL) {
    if (!isLoggedIn) {
      e.preventDefault();
      alert('ログインしていないため、ログアウトできません。');
    }
  }
});

// @in の入力欄: Enter で @out の定義に従って本文へ反映
preview.addEventListener('keydown', e => {
  if (e.target.matches('.in-input')) handleInInput(e, editor, currentNote, update, checkPushStatus);
});

// ----------------------------------------
// グローバル公開（HTML の onclick から呼ばれる関数）
// ----------------------------------------

window.togglePane = togglePane;
window.push = push;
window.pull = pullCurrentNote;
window.showPushDiff = showPushDiff;
window.showPullDiff = showPullDiff;
window.cancelPull = cancelPull;

update();

const urlParams = new URLSearchParams(location.search);
if (urlParams.get('error') === 'unauthorized_email') {
  alert('このGoogleアカウントは許可されていないため、ログインできません。');
  // クエリパラメータをURLから消す（リロードしても再表示しないように）
  const cleanURL = location.pathname;
  history.replaceState(null, '', cleanURL);
}

initFromURL();
checkAuth().then(() => checkCurrentNote());
