import { APP_BASE, API_BASE } from './constants.js';
import { COPY_ICON } from './svg.js';
import { storage, getAllNoteKeys } from './storage.js';
import { parseCustomMarkdown } from './parser.js';
import { renderDiff } from './diff.js';
import {
  rootNoteKey, currentNote, breadcrumbs,
  initNavigation, parsePathToCrumbs,
  switchNote, navigateToIndex,
  updateBreadcrumbs
} from './navigation.js';

// ----------------------------------------
// DOM
// ----------------------------------------

const editor = document.getElementById('editor');
const preview = document.getElementById('preview');

// ----------------------------------------
// State
// ----------------------------------------

if (localStorage.getItem('system_root_key') === null) {
  localStorage.setItem('system_root_key', `${APP_BASE}root`);
}

let currentMode = 'preview';
let preDiffMode = 'preview'; // diff に入る直前のモードを記憶（戻り先として使う）
const lastSyncedMap = new Map(); // path → サーバー確認済みの内容（書き込みは checkCurrentNote / push / pull のみ）
const pullNotes = new Set();

// ----------------------------------------
// 認証チェック
// ----------------------------------------

let isLoggedIn = false;

async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth/status`, { credentials: 'include' });
    const { loggedIn } = await res.json();
    isLoggedIn = loggedIn;
  } catch (e) {
    isLoggedIn = false;
  }
}

// ----------------------------------------
// Preview
// ----------------------------------------

function update() {
  preview.innerHTML = parseCustomMarkdown(editor.value);

  // @masks: 行クリックで行全体をトグル表示
  preview.querySelectorAll('.masks-row').forEach(row => {
    row.addEventListener('click', () => {
      row.classList.toggle('revealed');
    });

    // masks-cell 内のリンク・画像クリックを行トグルに伝播
    // ※ 行リスナーとの組み合わせ（バブリングによる重複を含む）は CSS と合わせて意図した挙動。変更しないこと。
    row.querySelectorAll('.masks-cell a, .masks-cell a img').forEach(el => {
      el.addEventListener('click', () => {
        row.classList.toggle('revealed');
      });
    });
  });

  // @hide: hide-col セル自体をクリックでトグル（行位置を維持）
  preview.querySelectorAll('.hide-col').forEach(cell => {
    cell.addEventListener('click', () => {
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
  });

  // @mask: 列セルにホバーで列全体を表示、列から離れたら隠す
  preview.querySelectorAll('table').forEach(table => {
    let activeColClass = null;

    table.addEventListener('mouseover', e => {
      const cell = e.target.closest('td');
      const colClass = cell && [...cell.classList].find(c => c.startsWith('mask-col-'));

      if (colClass === activeColClass) return;

      // 前の列を隠す
      if (activeColClass) {
        table.querySelectorAll(`.${activeColClass}`).forEach(c => c.classList.remove('revealed'));
      }

      // 新しい列を表示
      if (colClass) {
        table.querySelectorAll(`.${colClass}`).forEach(c => c.classList.add('revealed'));
      }

      activeColClass = colClass || null;
    });

    table.addEventListener('mouseleave', () => {
      if (activeColClass) {
        table.querySelectorAll(`.${activeColClass}`).forEach(c => c.classList.remove('revealed'));
        activeColClass = null;
      }
    });
  });
}

// ----------------------------------------
// Navigation の初期化（依存注入）
// ----------------------------------------

initNavigation(editor, update, ensurePreview, checkCurrentNote, checkPushStatus);

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
// Mode toggle
// ----------------------------------------

function updateModeLabel() {
  document.getElementById('mode-label').textContent =
    currentMode === 'edit' ? '編集中' :
    currentMode === 'diff' ? '差分確認中' : 'プレビュー中';
}

function ensurePreview() {
  if (currentMode === 'edit') togglePane();
  // diff モード中はそのまま維持
}

function togglePane() {
  if (currentMode === 'diff') {
    exitDiff(); // diff モード中はまず preDiffMode に戻し、
    currentMode = currentMode === 'edit' ? 'preview' : 'edit'; // その後にトグル
    applyModeClass();
    updateModeLabel();
    if (currentMode === 'preview') update();
    return;
  }

  const nextMode = currentMode === 'edit' ? 'preview' : 'edit';
  if (nextMode === 'edit' && pullNotes.has(currentNote)) {
    return;
  }
  currentMode = nextMode;
  applyModeClass();
  updateModeLabel();

  document.querySelectorAll('.btn-icon').forEach(icon => {
    icon.classList.toggle('btn-icon--pen', currentMode === 'preview');
    icon.classList.toggle('btn-icon--book', currentMode === 'edit');
    icon.alt = currentMode === 'edit' ? 'プレビュー' : '編集';
  });
  if (currentMode === 'preview') {
    update();
    checkPushStatus();
  }
}

// ----------------------------------------
// Init
// ----------------------------------------

if (localStorage.getItem('note:' + rootNoteKey) === null) {
  localStorage.setItem('note:' + rootNoteKey, `@alias r ${APP_BASE}root
@lastPath -

- [Markdown記法の一覧](r:/Markdown記法)
---
- [-](r:/設定)
- [フォーム](r:/form)`
  );
}

if (localStorage.getItem('note:' + APP_BASE + 'root/form') === null) {
  localStorage.setItem('note:' + APP_BASE + 'root/form',
    '- [ログイン](https://memo-app-server-bew5.onrender.com/auth/google)\n- [ログアウト](https://memo-app-server-bew5.onrender.com/auth/logout)'
  );
}

document.getElementById('app').className = 'mode-preview';

function initFromURL() {
  const fullPath = decodeURIComponent(location.pathname);
  const isBase = fullPath === APP_BASE.slice(0, -1) || fullPath === APP_BASE;
  const path = (fullPath.startsWith(APP_BASE) && !isBase)
    ? fullPath
    : rootNoteKey;
  switchNote(path);
}

// ----------------------------------------
// popstate
// ----------------------------------------

window.addEventListener('popstate', () => {
  const fullPath = decodeURIComponent(location.pathname);
  if (!fullPath.startsWith(APP_BASE.slice(0, -1))) return;
  switchNote(fullPath);
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
    switchNote(link.dataset.notePath);
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
  if (e.target.matches('.in-input')) handleInInput(e);
});

// ----------------------------------------
// copy to clipboard
// ----------------------------------------

function copyCode(btn) {
  const code = btn.nextElementSibling.querySelector('code').innerText;
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

// ----------------------------------------
// in/out input handler
// ----------------------------------------

function handleInInput(event) {
  if (event.key !== 'Enter') return;

  const raw = event.target.value.trim();
  if (!raw) return;

  const varNames = event.target.dataset.vars.split('\t');
  const seps = JSON.parse(event.target.dataset.seps || '[]');

  function splitBySeps(str, separators) {
    if (separators.length === 0) return str.split(/\s+/);
    const result = [];
    let remaining = str;
    while (remaining.length > 0) {
      let matchIdx = -1;
      let matchSep = null;
      for (const sep of separators) {
        const idx = remaining.indexOf(sep);
        if (idx !== -1 && (matchIdx === -1 || idx < matchIdx)) {
          matchIdx = idx;
          matchSep = sep;
        }
      }
      if (matchIdx === -1) { result.push(remaining); break; }
      result.push(remaining.slice(0, matchIdx));
      remaining = remaining.slice(matchIdx + matchSep.length);
    }
    return result;
  }

  const values = splitBySeps(raw, seps);

  const replaceData = event.target.dataset.replace || '';
  const replaceRules = replaceData ? JSON.parse(replaceData) : [];

  function applyReplace(str) {
    let result = str;
    for (const [from, to] of replaceRules) {
      result = result.replaceAll(from, to);
    }
    return result;
  }

  const bindings = {};
  varNames.forEach((name, idx) => {
    bindings[name] = applyReplace(values[idx] ?? '');
  });

  const lines = editor.value.split('\n');
  const outLineIndex = lines.findIndex(line => {
    const t = line.trim();
    if (!t.startsWith('@out<<') || !t.endsWith(';')) return false;
    return varNames.some(name => t.includes(name));
  });

  if (outLineIndex === -1) return;

  const outBody = lines[outLineIndex].trim().slice('@out<<'.length, -1);
  const tokens = outBody.split('<<');
  let output = '';
  let appendNewline = false;
  for (const token of tokens) {
    const t = token.trim();
    if (t === "'\\n'") {
      appendNewline = true;
    } else if (t.startsWith('"') && t.endsWith('"')) {
      output += t.slice(1, -1).replace(/(\\+)n/g, (_, slashes) => {
        const half = Math.floor(slashes.length / 2);
        return '\\'.repeat(half) + (slashes.length % 2 === 1 ? '\n' : 'n');
      });
    } else if (bindings[t] !== undefined) {
      output += bindings[t];
    }
  }

  if (appendNewline) {
    lines.splice(outLineIndex, 0, output);
  } else {
    if (outLineIndex > 0) {
      lines[outLineIndex - 1] += output;
    } else {
      lines.splice(outLineIndex, 0, output);
    }
  }
  editor.value = lines.join('\n');
  storage.set(currentNote, editor.value);
  update();

  event.target.value = '';
}

// ----------------------------------------
// Push / Pull
// ----------------------------------------

function checkPushStatus() {
  const toggleBtn = document.querySelector('.btn-toggle');
  if (pullNotes.has(currentNote)) {
    toggleBtn.style.display = 'none';
    setVisible('pull-btn', true);
    setVisible('pull-diff-btn', true);
    setVisible('push-btn', false);
    setVisible('push-diff-btn', false);
    return;
  }

  const lastSynced = lastSyncedMap.get(currentNote);
  if (lastSynced === undefined) {
    toggleBtn.style.display = 'none';
    setVisible('push-btn', false);
    setVisible('push-diff-btn', false);
    setVisible('pull-diff-btn', false); // pull-btn は pullNotes の分岐でのみ表示されるため、ここでは操作しない
    return;
  }

  // pullの非表示が確定してから表示
  toggleBtn.style.display = 'inline';

  const needsPush = editor.value !== lastSynced;
  setVisible('push-btn', needsPush);
  setVisible('push-diff-btn', needsPush);
  setVisible('pull-btn', false);
  setVisible('pull-diff-btn', false);
}

async function checkCurrentNote() {
  if (!isLoggedIn) return;
  const note = currentNote; // 非同期中に切り替わっても note を固定

  if (pullNotes.has(note)) {
    checkPushStatus();
    return;
  }
  if (lastSyncedMap.has(note)) {
    // サーバー確認済みの場合はローカルと最後の同期内容の比較だけ行う
    checkPushStatus();
    return;
  }

  try {
    const localContent = storage.get(note);
    const res = await fetch(`${API_BASE}/api/notes${note}`, { credentials: 'include' });

    // 非同期完了前に別ノートへ移動していたら結果を捨てる
    if (note !== currentNote) return;
    if (!res.ok && res.status !== 404) return; // 404以外のエラーは無視
    if (res.status === 404) {
      // サーバーに存在しない → 空を最後の同期内容として push を促す
      lastSyncedMap.set(note, '');
      checkPushStatus();
      return;
    }

    const { content: serverContent } = await res.json();
    lastSyncedMap.set(note, serverContent); // ノートごとに最後の同期内容を記録

    if (serverContent !== localContent) {
      pullNotes.add(note);
    }
    checkPushStatus();
  } catch (e) {}
}

async function pullCurrentNote() {
  const note = currentNote;
  const wasDiff = currentMode === 'diff';
  try {
    const res = await fetch(`${API_BASE}/api/notes${note}`, { credentials: 'include' });
    if (!res.ok) return; // 403・401 などはここで止める
    const { content } = await res.json();
    storage.set(note, content);
    lastSyncedMap.set(note, content); // ノートごとに最後の同期内容を更新
    if (note === currentNote) {
      setVisible('cancel-pull-btn', false);
      editor.value = content;
      if (wasDiff) {
        currentMode = 'preview';
        applyModeClass();
        update();
        updateModeLabel();
      } else {
        update();
      }
    }
    pullNotes.delete(note);
    if (note === currentNote) {
      checkPushStatus();
    }
  } catch (e) {}
}

async function push() {
  const note = currentNote; // push 中に切り替わっても note を固定
  const wasDiff = currentMode === 'diff';
  const content = storage.get(note) ?? '';
  await fetch(`${API_BASE}/api/notes${note}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    credentials: 'include'
  });
  lastSyncedMap.set(note, content); // ノートごとに最後の同期内容を更新
  if (note === currentNote) {
    if (wasDiff) {
      currentMode = 'preview';
      applyModeClass();
      update();
      updateModeLabel();
    }
    checkPushStatus();
  }
}

// ----------------------------------------
// Diff 表示
// ----------------------------------------

// diff モードに入る共通処理
function enterDiff(oldText, newText) {
  preDiffMode = currentMode; // 戻り先を記憶（edit / preview）
  preview.innerHTML = renderDiff(oldText, newText);
  currentMode = 'diff';
  applyModeClass();
  updateModeLabel();
}

// diff モードから抜ける（入る前のモードに戻る）
function exitDiff() {
  currentMode = preDiffMode;
  applyModeClass();
  if (currentMode === 'preview') update();
  updateModeLabel();
  checkPushStatus();
}

// push確認: サーバー(赤) → ローカル(緑)
function showPushDiff() {
  // トグル: すでに diff 中なら戻る
  if (currentMode === 'diff') {
    exitDiff();
    return;
  }
  const local = editor.value;
  const server = lastSyncedMap.get(currentNote) ?? '';
  enterDiff(server, local);
}

// pullしない: pullNotes から除外してdiffモードのまま維持
function cancelPull() {
  pullNotes.delete(currentNote);
  setVisible('cancel-pull-btn', false);
  const local = editor.value;
  preview.innerHTML = renderDiff(local, local);
  checkPushStatus();
}

// pull確認: ローカル(赤) → サーバー(緑)
async function showPullDiff() {
  // トグル: すでに diff 中なら戻る
  if (currentMode === 'diff') {
    exitDiff();
    setVisible('cancel-pull-btn', false);
    return;
  }
  const local = editor.value;
  try {
    const res = await fetch(`${API_BASE}/api/notes${currentNote}`, { credentials: 'include' });
    if (!res.ok) return;
    const { content: server } = await res.json();
    enterDiff(local, server);
    setVisible('cancel-pull-btn', true);
  } catch (e) {}
}

// ----------------------------------------
// グローバル公開（HTML の onclick から呼ばれる関数）
// ----------------------------------------

window.switchNote = switchNote;
window.navigateToIndex = navigateToIndex;
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

checkAuth().then(() => initFromURL());
