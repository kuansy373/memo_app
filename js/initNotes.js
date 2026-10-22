import { APP_BASE, API_BASE } from './constants.js';

export function initNotes(initialNoteKey) {
  if (localStorage.getItem('system_initial_note') === null) {
    localStorage.setItem('system_initial_note', `${APP_BASE}initial`);
  }

  if (localStorage.getItem('note:' + initialNoteKey) === null) {
    localStorage.setItem('note:' + initialNoteKey, `---
- [ユーザーホーム](/home)
---
- [Markdown記法の一覧](/Markdown記法)
- [設定](/settings)
- [フォーム](/form)`
    );
  }

  if (localStorage.getItem('note:' + APP_BASE + 'settings') === null) {
    localStorage.setItem('note:' + APP_BASE + 'settings',
      `**テーマ**

<div class="theme-selector">
  <label><input type="radio" name="theme" value="system"  data-action="theme" checked> システム</label>
  <label><input type="radio" name="theme" value="light"   data-action="theme"> ライト</label>
  <label><input type="radio" name="theme" value="dark"    data-action="theme"> ダーク</label>
</div>

---

**ショートカットキー**

<div class="shortcut-setting" data-shortcut="togglePane">
  <span class="shortcut-label">モード切替（プレビュー/編集）</span>
  <input class="shortcut-input" type="text" readonly placeholder="(なし)">
  <button data-action="shortcut-reset">既定値に戻す</button>
  <button data-action="shortcut-clear">クリア</button>
</div>`
    );
  }

  if (localStorage.getItem('note:' + APP_BASE + 'form') === null) {
    localStorage.setItem('note:' + APP_BASE + 'form',
      '- [ログイン](' + API_BASE + '/auth/google)\n- [ログアウト](' + API_BASE + '/auth/logout)'
    );
  }
}
