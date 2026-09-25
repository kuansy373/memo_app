import { APP_BASE, API_BASE } from './constants.js';
import { COPY_ICON } from './svg.js';
import { storage, getAllNoteKeys } from './storage.js';
import { parseCustomMarkdown } from './parser.js';
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

let currentMode = 'edit';
const baselineMap = new Map(); // path → サーバー確認済みの内容（書き込みは checkCurrentNote / push / pull のみ）
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
// Mode toggle
// ----------------------------------------

function updateModeLabel() {
  document.getElementById('mode-label').textContent =
    currentMode === 'edit' ? '編集中' : 'プレビュー中';
}

function ensurePreview() {
  if (currentMode === 'edit') togglePane();
}

function togglePane() {
  const nextMode = currentMode === 'edit' ? 'preview' : 'edit';
  if (nextMode === 'edit' && pullNotes.has(currentNote)) {
    const answer = confirm('最新の内容がサーバーにあります。pullしますか？\npullしない場合、この端末の現状が最新の内容として扱われます。');
    if (answer) {
      pullCurrentNote();
      return;
    } else {
      pullNotes.delete(currentNote);
      baselineMap.set(currentNote, null); // サーバー内容不明・push が必要な状態
      document.getElementById('pull-btn').style.display = 'none';
    }
  }
  currentMode = currentMode === 'edit' ? 'preview' : 'edit';
  document.getElementById('app').className = 'mode-' + currentMode;
  updateModeLabel();

  document.querySelectorAll('.btn-icon').forEach(icon => {
    icon.classList.toggle('btn-icon--pen',  currentMode === 'preview');
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
  localStorage.setItem('note:' + rootNoteKey, `
@alias r ${APP_BASE}root
@lastPath -
- [-](r:/デモ)
- [-](r:/設定)
- [ログイン/ログアウト](r:/form)`
  );
}

if (localStorage.getItem('note:' + APP_BASE + 'root/form') === null) {
  localStorage.setItem('note:' + APP_BASE + 'root/form',
    '- [ログイン](https://memo-app-server-bew5.onrender.com/auth/google)\n- [ログアウト](https://memo-app-server-bew5.onrender.com/auth/logout)'
  );
}

document.getElementById('app').className = 'mode-edit';

function initFromURL() {
  const fullPath = decodeURIComponent(location.pathname);
  const isBase = fullPath === APP_BASE.slice(0, -1) || fullPath === APP_BASE;
  const path = (fullPath.startsWith(APP_BASE) && !isBase)
    ? fullPath
    : rootNoteKey;
  switchNote(path, { save: false });
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
  storage.set(currentNote, editor.value);
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
  storage.set(currentNote, editor.value);
  update();
});

// スマホ: コードブロックのタップでコピーボタン表示トグル
preview.addEventListener('click', e => {
  const wrapper = e.target.closest('.code-block-wrapper');
  if (!wrapper) {
    document.querySelectorAll('.code-block-wrapper.touch-active')
      .forEach(el => el.classList.remove('touch-active'));
  } else {
    if (!e.target.closest('.copy-btn')) {
      wrapper.classList.toggle('touch-active');
    }
  }

  // ログイン/ログアウトリンクのインターセプト
  const link = e.target.closest('a');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  const loginURL = `${API_BASE}/auth/google`;
  const logoutURL = `${API_BASE}/auth/logout`;

  if (href === loginURL) {
    if (isLoggedIn) {
      e.preventDefault();
      alert('すでにログイン済みです。アカウントを切り替える場合は一度ログアウトしてください。');
    }
  } else if (href === logoutURL) {
    if (!isLoggedIn) {
      e.preventDefault();
      alert('ログインしていないため、ログアウトできません。');
    }
  }
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
  if (pullNotes.has(currentNote)) {
    document.getElementById('pull-btn').style.display = 'inline';
    document.getElementById('push-btn').style.display = 'none';
    return;
  }
  const baseline = baselineMap.get(currentNote);
  if (baseline === undefined) {
    // サーバー未確認のためボタンを出さない（checkCurrentNote の結果を待つ）
    document.getElementById('push-btn').style.display = 'none';
    return;
  }
  if (baseline === null || editor.value !== baseline) {
    // null = pull 拒否済み（サーバーと差分あり確定）
    document.getElementById('push-btn').style.display = 'inline';
    document.getElementById('pull-btn').style.display = 'none';
  } else {
    document.getElementById('push-btn').style.display = 'none';
    document.getElementById('pull-btn').style.display = 'none';
  }
}

async function checkCurrentNote() {
  if (!isLoggedIn) return;
  const note = currentNote; // 非同期中に切り替わっても note を固定

  if (pullNotes.has(note)) {
    checkPushStatus();
    return;
  }
  if (baselineMap.has(note) && baselineMap.get(note) !== null) {
    // サーバー確認済み・pull拒否済みでない場合はローカルとベースラインの比較だけ行う
    checkPushStatus();
    return;
  }

  try {
    const localContent = storage.get(note);
    const res = await fetch(`${API_BASE}/api/notes${note}`, { credentials: 'include' });

    // 非同期完了前に別ノートへ移動していたら結果を捨てる
    if (note !== currentNote) return;

    if (res.status === 404) {
      // サーバーに存在しない → 空をベースラインとして push を促す
      baselineMap.set(note, '');
      checkPushStatus();
      return;
    }

    const { content: serverContent } = await res.json();
    baselineMap.set(note, serverContent); // ノートごとにベースラインを記録

    if (serverContent !== localContent) {
      pullNotes.add(note);
    }
    checkPushStatus();
  } catch (e) {}
}

async function pullCurrentNote() {
  const note = currentNote;
  try {
    const res = await fetch(`${API_BASE}/api/notes${note}`, { credentials: 'include' });
    if (res.status === 404) return;
    const { content } = await res.json();
    storage.set(note, content);
    baselineMap.set(note, content); // ノートごとにベースラインを更新
    if (note === currentNote) {
      editor.value = content;
      update();
    }
    pullNotes.delete(note);
    if (note === currentNote) {
      checkPushStatus();
    }
  } catch (e) {}
}

async function push() {
  const note = currentNote; // push 中に切り替わっても note を固定
  const content = storage.get(note);
  await fetch(`${API_BASE}/api/notes${note}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    credentials: 'include'
  });
  baselineMap.set(note, content); // ノートごとにベースラインを更新
  if (note === currentNote) {
    checkPushStatus();
  }
}

// ----------------------------------------
// グローバル公開（HTML の onclick から呼ばれる関数）
// ----------------------------------------

window.switchNote = switchNote;
window.navigateToIndex = navigateToIndex;
window.togglePane = togglePane;
window.copyCode = copyCode;
window.handleInInput = handleInInput;
window.push = push;
window.pull = pullCurrentNote;

update();

checkAuth().then(() => initFromURL());
