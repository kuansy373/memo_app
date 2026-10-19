import { APP_BASE } from './constants.js';
import { LINK_ICON } from './svg.js';
import { escapeHtml, escapeAttr, renderCodeBlock } from './utils.js';

// --- モジュールレベル定数・純粋関数 ---

const CALLOUT_COLORS = {
  tip: '#0ea5e9', note: '#6366f1', warning: '#f59e0b', danger: '#ef4444', info: '#0ea5e9',
};
const parseCalloutColor = type => CALLOUT_COLORS[type] ?? '#888';

function isBlockquoteLine(line) {
  return line.startsWith('> ') || line.trim() === '>' || /^ +> /.test(line) || /^ +>$/.test(line);
}

function stripBlockquotePrefix(line) {
  return line.replace(/^ *> ?/, '');
}

// 行頭の > の個数（深さ）を返す。> のない行は -1。
function blockquoteDepth(line) {
  let d = 0;
  let s = line;
  while (s.startsWith('> ') || s === '>') {
    d++;
    s = s.startsWith('> ') ? s.slice(2) : '';
  }
  return d > 0 ? d - 1 : -1; // 0始まりの深さに変換
}

// [{depth, text}] を受け取り、ネストした <blockquote> HTML を返す。
function renderDepthLines(depthLines, currentDepth) {
  const parts = [];
  let i = 0;
  while (i < depthLines.length) {
    const { depth } = depthLines[i];
    if (depth === currentDepth) {
      // 同じ深さの連続行をまとめて parseCustomMarkdown で処理
      const block = [];
      while (i < depthLines.length && depthLines[i].depth === currentDepth) {
        block.push(depthLines[i].text);
        i++;
      }
      parts.push(parseCustomMarkdown(block.join('\n')));
    } else if (depth > currentDepth) {
      // 再帰で <blockquote> にする
      const nested = [];
      while (i < depthLines.length && depthLines[i].depth > currentDepth) {
        nested.push(depthLines[i]);
        i++;
      }
      parts.push(`<blockquote>${renderDepthLines(nested, currentDepth + 1)}</blockquote>`);
    } else {
      break;
    }
  }
  return parts.join('');
}

function isTableRow(line) {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|');
}

function isSeparator(line) {
  return /^\|[\s\-:|]+\|/.test(line.trim());
}

function parseTableAligns(sepLine) {
  return sepLine.trim().slice(1, -1).split('|').map(s => {
    s = s.trim();
    if (s.startsWith(':') && s.endsWith(':')) return 'center';
    if (s.endsWith(':')) return 'right';
    return 'left';
  });
}

export function parseAliases(text) {
  const aliases = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^@alias\s+(\S+)\s+(\S+)/);
    if (m) aliases[m[1]] = m[2];
  }
  return aliases;
}

function _parseInline(s, aliases, lastPathPlaceholder) {
  const codes = [];

  s = s.replace(/(`{2,})(.+?)\1|`([^`]+)`/gs, (_, fence, code, single) => {
    const raw = fence ? code.trim() : single;
    codes.push(`<code>${escapeHtml(raw)}</code>`);
    return `\x00${codes.length - 1}\x00`;
  });

  s = s
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')

    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_, text, url) => {
      if (!url) return text;

      const aliasMatch = url.match(/^([^:]+):(.+)/);
      if (aliasMatch && aliases[aliasMatch[1]]) {
        url = aliases[aliasMatch[1]] + aliasMatch[2];
      }

      if (!url.startsWith('http') && url.startsWith('/')) {
        url = APP_BASE + url.slice(1);
      }

      const rawPath = url.startsWith(`${location.origin}${APP_BASE}`)
        ? url.slice(location.origin.length)
        : url.startsWith(APP_BASE) ? url : null;
      if (rawPath !== null) {
        let label = text;
        if (lastPathPlaceholder && text === lastPathPlaceholder) {
          label = rawPath.split('/').filter(Boolean).pop() || rawPath;
        }
        return `<a href="${escapeAttr(rawPath)}" data-note-path="${escapeAttr(rawPath)}">${label || rawPath}</a>`;
      }

      if (!/^https?:\/\//.test(url)) {
        return text || url;
      }

      const label = text ? `${text}${LINK_ICON}` : LINK_ICON;
      return `<a href="${escapeAttr(url)}" target="_blank">${label}</a>`;
    });

  s = s.replace(/~~(.+?)~~/gs, '<s>$1</s>');
  s = s.replace(/\x00(\d+)\x00/g, (_, idx) => codes[idx]);

  return s;
}

// コードフェンスの開閉状態を一行ずつ更新するユーティリティ。
// state = { inFence: bool, fenceStr: string } を受け取って変更し、
// 変更後の状態を返す（呼び出し側は同じオブジェクトを使い回す）。
function updateFenceState(line, state) {
  const m = line.trim().match(/^(`{3,}|~{3,})/);
  if (!m) return state;
  if (!state.inFence) {
    state.inFence = true;
    state.fenceStr = m[1][0].repeat(m[1].length);
  } else if (line.trim() === state.fenceStr) {
    state.inFence = false;
    state.fenceStr = '';
  }
  return state;
}

// lines[startIdx] がコードフェンス開始行のとき、対応する閉じ行のインデックスを返す。
// 見つからなければ -1。
function findClosingFence(lines, startIdx) {
  const fence = lines[startIdx].trim().match(/^(`+)/)?.[1];
  if (!fence) return -1;
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (lines[j].trim() === fence) return j;
  }
  return -1;
}

function parseFrontmatter(lines) {
  const aliases = {};
  let lastPathPlaceholder = null;
  for (const line of lines) {
    const a = line.match(/^@alias\s+(\S+)\s+(\S+)/);
    if (a) { aliases[a[1]] = a[2]; continue; }
    const p = line.match(/^@lastPath\s+(\S+)/);
    if (p) lastPathPlaceholder = p[1];
  }
  return { aliases, lastPathPlaceholder };
}

export function parseCustomMarkdown(text) {
  const lines = text.split('\n');
  const parts = [];
  let i = 0;
  let inList = null;

  const { aliases, lastPathPlaceholder } = parseFrontmatter(lines);

  function parseInline(s) {
    return _parseInline(s, aliases, lastPathPlaceholder);
  }

  let savedList = null;

  function closeList() {
    if (!inList) return;
    savedList = inList.map(item => ({ ...item }));
    while (inList.length > 0) {
      parts.push(`</${inList.pop().type}>`);
    }
    inList = null;
  }

  function openList(type, num) {
    parts.push(type === 'ol' ? `<ol start="${num}">` : '<ul>');
  }

  // 行群（> を剥がし済み）を空行で区切りセクション分割して HTML 化する。
  // fullParse: コールアウト本文など全構文を処理したいときは true、
  //            blockquote のように <p> で十分な場合は false。
  function renderLines(bodyLines, fullParse) {
    const sections = [];
    let cur = [];
    const fenceState = { inFence: false, fenceStr: '' };
    for (const l of bodyLines) {
      updateFenceState(l, fenceState);
      if (!fenceState.inFence && l.trim() === '') {
        if (cur.length) { sections.push(cur); cur = []; }
        sections.push(null); // null = 空行マーカー
      } else {
        cur.push(l);
      }
    }
    if (cur.length) sections.push(cur);

    return sections.map((sec, idx, arr) => {
      if (sec === null) {
        return (arr[idx - 1] && arr[idx + 1]) ? '<br>' : '';
      }
      if (fullParse) {
        return parseCustomMarkdown(sec.join('\n'));
      }
      const hasNested = sec.some(l => l.startsWith('> ') || l.trim() === '>');
      const hasList = sec.some(l => /^(\s*)([-*+]|\d+\.)\s/.test(l));
      return hasNested || hasList
        ? parseCustomMarkdown(sec.join('\n'))
        : sec.map(l => `<p>${parseInline(l)}</p>`).join('');
    }).join('');
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('@alias')) { i++; continue; }
    if (trimmed.startsWith('@lastPath')) { i++; continue; }

    // @in"sep">>var1>>var2; または @in'sep'>>var1>>var2; 構文
    const inMatch = trimmed.match(
      /^@in(?<seps>(?:["'][^"']*["'],)*(?:["'][^"']*["']))?(?<vars>(?:>>[^>]+)+);$/
    );
    if (inMatch) {
      closeList();
      const varNames = inMatch.groups.vars.split('>>').filter(Boolean);
      const sepRaw = inMatch.groups.seps || '';
      const useSingleQuote = sepRaw.startsWith("'");
      const quoteChar = useSingleQuote ? "'" : '"';
      const sepRegex = new RegExp(`${quoteChar}([^${quoteChar}]*)${quoteChar}`, 'g');
      const seps = sepRaw ? [...sepRaw.matchAll(sepRegex)].map(m => m[1]) : [];
      const placeholder = useSingleQuote && seps.length > 0
        ? varNames.join(seps[0])
        : varNames.join(' ');
      // 直後の @replace 行を読み取る
      let replaceRules = [];
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith('@replace ')) {
        const replaceLine = lines[i + 1].trim();
        const ruleStr = replaceLine.slice('@replace '.length, -1);
        const ruleMatches = [...ruleStr.matchAll(/"((?:[^"\\]|\\.)*)"->"((?:[^"\\]|\\.)*)"/g)];
        replaceRules = ruleMatches.map(m => [m[1], m[2]]);
      }
      const replaceJson = JSON.stringify(replaceRules).replace(/\\/g, '\\\\');
      const sepsJson = JSON.stringify(seps);
      parts.push(
        `<input type="text" placeholder="${escapeAttr(placeholder)}" ` +
        `data-vars="${escapeAttr(varNames.join('\t'))}" ` +
        `data-seps="${escapeAttr(sepsJson)}" ` +
        `data-replace="${escapeAttr(replaceJson)}" ` +
        `class="in-input">`
      );
      i++; continue;
    }

    // @replace 構文（プレビューには表示しない）
    if (trimmed.startsWith('@replace ') && trimmed.endsWith(';')) { i++; continue; }

    // @out<<...<<'\n'; 構文
    if (trimmed.startsWith('@out<<') && trimmed.endsWith(';')) { i++; continue; }

    if (isTableRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      closeList();
      const aligns = parseTableAligns(lines[i + 1]);
      const rawHeaderCells = line.trim().slice(1, -1).split('|');

      // @mask / @masks / @hide の検出（複数指定可: @masks@hide）
      // @masks を先に検査し、/@mask(?!s)/ で @masks への誤マッチを防ぐ。
      const maskCols = rawHeaderCells.map(cell => {
        const t = cell.trim();
        const hasMasks = /@masks/.test(t);
        const hasMask  = !hasMasks && /@mask(?!s)/.test(t);
        const hasHide  = /@hide/.test(t);
        if (hasMasks && hasHide) return 'masks+hide';
        if (hasMasks) return 'masks';
        if (hasMask)  return 'mask';
        if (hasHide)  return 'hide';
        return null;
      });
      const rowMask = maskCols.some(m => m === 'masks' || m === 'masks+hide');

      parts.push('<table><thead><tr>');
      rawHeaderCells.forEach((cell, ci) => {
        const t = cell.trim().replace(/@masks|@mask|@hide/g, '');
        const classes = [];
        if (maskCols[ci] === 'hide' || maskCols[ci] === 'masks+hide') classes.push(`hide-col hide-col-${ci}`);
        const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
        parts.push(`<th${cls}>${parseInline(t)}</th>`);
      });
      parts.push('</tr></thead><tbody>');
      i += 2;

      while (i < lines.length && isTableRow(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split('|');
        const trClass = rowMask ? ' class="masks-row"' : '';
        parts.push(`<tr${trClass}>`);
        cells.forEach((cell, ci) => {
          const align = `text-align:${aligns[ci] || 'left'}`;
          const content = parseInline(cell.trim());
          const classes = [];
          if (maskCols[ci] === 'masks') classes.push('masks-cell');
          else if (maskCols[ci] === 'mask') classes.push(`mask-cell mask-col-${ci}`);
          else if (maskCols[ci] === 'hide') classes.push(`hide-col hide-col-${ci}`);
          else if (maskCols[ci] === 'masks+hide') classes.push(`hide-col hide-col-${ci}`, 'masks-cell');
          const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
          parts.push(`<td style="${align}"${cls}>${content}</td>`);
        });
        parts.push('</tr>');
        i++;
      }
      parts.push('</tbody></table>');
      continue;
    }

    const headMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headMatch) {
      closeList();
      const level = headMatch[1].length;
      parts.push(`<h${level}>${parseInline(headMatch[2])}</h${level}>`);
      i++; continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      closeList();
      parts.push('<hr>');
      i++; continue;
    }

    if (trimmed.startsWith('```')) {
      const fence = trimmed.match(/^(`+)/)[1];
      const rest = trimmed.slice(fence.length).trim();
      const isCodeFence = rest === '' || /^\w+$/.test(rest); // 言語指定のみ or 空
      if (isCodeFence) {
        const closeIdx = findClosingFence(lines, i);
        if (closeIdx !== -1) {
          closeList();
          const lang = rest;
          const code = lines.slice(i + 1, closeIdx).join('\n');
          i = closeIdx + 1;
          parts.push(renderCodeBlock(code, lang));
          continue;
        }
      }
    }

    if (isBlockquoteLine(line)) {
      closeList();
      const calloutMatch = trimmed.match(/^> \[!(\w*)\]([+-])?\s*(.*)/);
      if (calloutMatch) {
        const type = calloutMatch[1].toLowerCase();
        const foldSymbol = calloutMatch[2];
        const isPlainFold = type === '' && (foldSymbol === '+' || foldSymbol === '-');
        const isValidCallout = type !== '' || isPlainFold;

        if (isValidCallout) {
          const foldable = isPlainFold || foldSymbol === '+' || foldSymbol === '-';
          const defaultOpen = foldSymbol === '+';
          const title = calloutMatch[3] || type;
          const color = parseCalloutColor(type);
          i++;
          const bodyLines = [];
          while (i < lines.length) {
            const l = lines[i];
            if (l.trim() === '') break;
            // > あり行はプレフィックスを1段だけ剥がす。> なし行はそのまま。
            bodyLines.push(isBlockquoteLine(l) ? stripBlockquotePrefix(l) : l);
            i++;
          }
          const body = renderLines(bodyLines, true);
          const innerHtml = `<div class="callout-body">${body}</div>`;
          if (foldable) {
            const openAttr = defaultOpen ? ' open' : '';
            if (isPlainFold) {
              parts.push(
                `<details${openAttr}>` +
                `<summary>${title}</summary>` +
                body +
                `</details>`
              );
            } else {
              parts.push(
                `<details class="callout"${openAttr} style="border-color:${color};">` +
                `<summary class="callout-title" style="color:${color};">${title}</summary>` +
                innerHtml +
                `</details>`
              );
            }
          } else {
            parts.push(
              `<div class="callout" style="border-color:${color};">` +
              `<div class="callout-title" style="color:${color};">${title}</div>` +
              body +
              `</div>`
            );
          }
          continue;
        }
      }
      // 連続する行を深さ付きで収集し、ネスト構造の <blockquote> を生成する。
      const bqDepthLines = [];
      let lastDepth = 0;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === '') break;
        const d = blockquoteDepth(l);
        if (d >= 0) {
          // > あり行：深さを更新し、> を全部剥がしたテキストを追加
          lastDepth = d;
          let text = l;
          for (let k = 0; k <= d; k++) text = text.replace(/^ *> ?/, '');
          bqDepthLines.push({ depth: d, text });
        } else {
          // > なし行：直前の深さを継承
          bqDepthLines.push({ depth: lastDepth, text: l });
        }
        i++;
      }
      // 末尾の空行を除去
      while (bqDepthLines.length > 0 && bqDepthLines[bqDepthLines.length - 1].text.trim() === '') bqDepthLines.pop();
      parts.push(`<blockquote>${renderDepthLines(bqDepthLines, 0)}</blockquote>`);
      continue;
    }

    const caretMatch = line.match(/^\^(\s*)([-*+]|\d+\.)\s(.*)/);
    if (caretMatch && savedList) {
      // ^ をスペース1文字に置き換えてインデント深さを計算する
      const depth = Math.floor((1 + caretMatch[1].length) / 2);
      const type = /\d+\./.test(caretMatch[2]) ? 'ol' : 'ul';
      const num = type === 'ol' ? parseInt(caretMatch[2], 10) : null;
      const content = caretMatch[3];
      // savedList のうち ^ 行の深さ以下の階層だけ復元して開きタグを再出力する
      inList = savedList.filter(item => item.depth <= depth).map(item => ({ ...item }));
      for (const item of inList) {
        parts.push(item.type === 'ol' ? `<ol start="${item.nextNum}">` : '<ul>');
      }
      savedList = null;
      const current = inList[inList.length - 1];
      if (!current) {
        openList(type, num);
        inList.push({ type, depth, nextNum: num != null ? num + 1 : null });
      } else if (current.depth === depth) {
        // 復元済みのため何もしない
      } else if (depth > current.depth) {
        openList(type, num);
        inList.push({ type, depth, nextNum: num != null ? num + 1 : null });
      } else {
        while (inList.length > 1 && inList[inList.length - 1].depth > depth) {
          parts.push(`</${inList.pop().type}>`);
        }
      }
      // depth % 2 → 偶数/奇数でスタイルをトグルする CSS クラス（0 or 1）
      parts.push(`<li class="list-depth-${depth % 2}">${parseInline(content)}</li>`);
      i++; continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s(.*)/);
    if (listMatch) {
      const depth = Math.floor(listMatch[1].length / 2);
      const type = /\d+\./.test(listMatch[2]) ? 'ol' : 'ul';
      const num = type === 'ol' ? parseInt(listMatch[2], 10) : null;
      const content = listMatch[3];

      if (!inList) {
        savedList = null; // 通常リスト開始時にリセット
        openList(type, num);
        inList = [{ type, depth, nextNum: num != null ? num + 1 : null }];
      } else {
        const current = inList[inList.length - 1];
        if (depth > current.depth) {
          openList(type, num);
          inList.push({ type, depth, nextNum: num != null ? num + 1 : null });
        } else if (depth < current.depth) {
          while (inList.length > 1 && inList[inList.length - 1].depth > depth) {
            parts.push(`</${inList.pop().type}>`);
          }
          if (inList[inList.length - 1].type !== type) {
            parts.push(`</${inList.pop().type}>`);
            openList(type, num);
            inList.push({ type, depth, nextNum: num != null ? num + 1 : null });
          }
        } else {
          if (current.type !== type) {
            parts.push(`</${inList.pop().type}>`);
            openList(type, num);
            inList.push({ type, depth, nextNum: num != null ? num + 1 : null });
          } else {
            // 同じ階層・同じタイプに li を追加する場合のみインクリメント
            if (inList[inList.length - 1].type === 'ol') {
              inList[inList.length - 1].nextNum++;
            }
          }
        }
      }
      // depth % 2 → 偶数/奇数でスタイルをトグルする CSS クラス（0 or 1）
      parts.push(`<li class="list-depth-${depth % 2}">${parseInline(content)}</li>`);
      i++; continue;
    }

    if (trimmed === '') {
      closeList();
      i++; continue;
    }

    closeList();
    parts.push(`<p>${parseInline(trimmed)}</p>`);
    i++;
  }

  closeList();
  return parts.join('');
}
