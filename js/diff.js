import { escapeHtml } from './utils.js';

// LCS を使った行単位 diff
// 戻り値: { type: 'same'|'del'|'add', line: string }[]
export function computeLineDiff(oldLines, newLines) {
  const O = oldLines.length;
  const N = newLines.length;

  // LCS テーブル
  const dp = Array.from({ length: O + 1 }, () => new Array(N + 1).fill(0));
  for (let i = 1; i <= O; i++) {
    for (let j = 1; j <= N; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // バックトレース
  const result = [];
  let i = O, j = N;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'same', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'del', line: oldLines[i - 1] });
      i--;
    }
  }
  return result.reverse();
}

// diff 結果を HTML に変換
// del が連続したら連続表示、その後にまとめて add を出す
export function renderDiffHtml(hunks) {
  let html = '<div class="diff-view">';
  let i = 0;
  while (i < hunks.length) {
    const h = hunks[i];
    if (h.type === 'same') {
      html += `<div class="diff-line diff-same">${escLine(h.line)}</div>`;
      i++;
    } else if (h.type === 'del') {
      // del が続く限りまとめる
      while (i < hunks.length && hunks[i].type === 'del') {
        html += `<div class="diff-line diff-del">${escLine(hunks[i].line)}</div>`;
        i++;
      }
      // 直後の add をまとめて出す
      while (i < hunks.length && hunks[i].type === 'add') {
        html += `<div class="diff-line diff-add">${escLine(hunks[i].line)}</div>`;
        i++;
      }
    } else {
      // del なしで add だけ（末尾への追加）
      html += `<div class="diff-line diff-add">${escLine(h.line)}</div>`;
      i++;
    }
  }
  html += '</div>';
  return html;
}

function escLine(text) {
  return escapeHtml(text) || '&nbsp;'; // 空行も高さを保つ
}

// 2つのテキストの行単位 diff を HTML にして返す
export function renderDiff(oldText, newText) {
  return renderDiffHtml(computeLineDiff(oldText.split('\n'), newText.split('\n')));
}
