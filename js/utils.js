import { COPY_ICON } from './svg.js';

// HTML テキストノード用のエスケープ（& < > のみ）
export function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// HTML 属性値用のエスケープ（" で囲む前提。' も念のため変換する）
export function escapeAttr(text) {
  return escapeHtml(text)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// コピーボタン付きコードブロックの HTML を生成する
// ※ ui.js の copyCode は「ボタンの次の兄弟要素 > code」という構造に依存している
// ※ クリックは ui.js の preview に付けたイベント委譲が data-action="copy" で拾う
export function renderCodeBlock(code) {
  return (
    `<div class="code-block-wrapper">` +
    `<button class="copy-btn" data-action="copy" aria-label="コピー">${COPY_ICON}</button>` +
    `<pre><code>${escapeHtml(code)}</code></pre>` +
    `</div>`
  );
}
