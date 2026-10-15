import { APP_BASE, API_BASE } from './constants.js';

export function initNotes(rootNoteKey) {
  if (localStorage.getItem('system_root_key') === null) {
    localStorage.setItem('system_root_key', `${APP_BASE}root`);
  }

  if (localStorage.getItem('note:' + rootNoteKey) === null) {
    localStorage.setItem('note:' + rootNoteKey, `@alias r ${APP_BASE}root
@lastPath -

- [Markdown記法の一覧](r:/Markdown記法)
---
- [設定](r:/settings)
- [フォーム](r:/form)`
    );
  }

  if (localStorage.getItem('note:' + APP_BASE + 'root/settings') === null) {
    localStorage.setItem('note:' + APP_BASE + 'root/settings',
      `テーマ

<div class="theme-selector">
  <label><input type="radio" name="theme" value="system"  data-action="theme" checked> システム</label>
  <label><input type="radio" name="theme" value="light"   data-action="theme"> ライト</label>
  <label><input type="radio" name="theme" value="dark"    data-action="theme"> ダーク</label>
</div>`
    );
  }

  if (localStorage.getItem('note:' + APP_BASE + 'root/form') === null) {
    localStorage.setItem('note:' + APP_BASE + 'root/form',
      '- [ログイン](' + API_BASE + '/auth/google)\n- [ログアウト](' + API_BASE + '/auth/logout)'
    );
  }
}
