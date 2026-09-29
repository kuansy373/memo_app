import { COPY_ICON } from './svg.js';

// HTML テキストノード用のエスケープ（& < > のみ）
export function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// コピーボタン付きコードブロックの HTML を生成する
// ※ ui.js の copyCode は「ボタンの次の兄弟要素 > code」という構造に依存している
export function renderCodeBlock(code) {
  return (
    `<div class="code-block-wrapper">` +
    `<button class="copy-btn" onclick="copyCode(this)" aria-label="コピー">${COPY_ICON}</button>` +
    `<pre><code>${escapeHtml(code)}</code></pre>` +
    `</div>`
  );
}
