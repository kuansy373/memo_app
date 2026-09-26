import { APP_BASE } from './constants.js';
import { LINK_ICON, COPY_ICON } from './svg.js';

export function parseAliases(text) {
  const aliases = {};
  text.split('\n').forEach(line => {
    const m = line.match(/^@alias\s+(\S+)\s+(\S+)/);
    if (m) aliases[m[1]] = m[2];
  });
  return aliases;
}

export function parseCustomMarkdown(text) {
  const lines = text.split('\n');
  const parts = [];
  let i = 0;
  let inList = null;

  const aliases = parseAliases(text);

  // @lastPath <placeholder> の読み取り
  let lastPathPlaceholder = null;
  text.split('\n').forEach(line => {
    const m = line.match(/^@lastPath\s+(\S+)/);
    if (m) lastPathPlaceholder = m[1];
  });

  function parseInline(s) {
    const codes = [];

    s = s.replace(/`(.+?)`/g, (_, code) => {
      const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      codes.push(`<code>${escaped}</code>`);
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

        const isSameApp = url.startsWith(APP_BASE) || url.startsWith(`${location.origin}${APP_BASE}`);
        if (isSameApp) {
          const fullUrl = url.startsWith('http') ? url : `${location.origin}${url}`;
          const rawPath = fullUrl.slice(location.origin.length);
          let label = text;
          if (lastPathPlaceholder && text === lastPathPlaceholder) {
            label = rawPath.split('/').filter(Boolean).pop() || rawPath;
          }
          return `<a href="#" onclick="switchNote('${rawPath}'); return false;">${label || rawPath}</a>`;
        }

        if (!/^https?:\/\//.test(url)) {
          return text || url;
        }

        const label = text ? `${text}${LINK_ICON}` : LINK_ICON;
        return `<a href="${url}" target="_blank">${label}</a>`;
      });

    s = s.replace(/~~(.+?)~~/gs, '<s>$1</s>');
    s = s.replace(/\x00(\d+)\x00/g, (_, idx) => codes[idx]);

    return s;
  }

  function closeList() {
    if (!inList) return;
    while (inList.length > 0) {
      parts.push(`</${inList.pop().type}>`);
    }
    inList = null;
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

  function parseCalloutColor(type) {
    const colors = { tip: '#0ea5e9', note: '#6366f1', warning: '#f59e0b', danger: '#ef4444', info: '#0ea5e9' };
    return colors[type] || '#888';
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('@alias')) { i++; continue; }
    if (trimmed.startsWith('@lastPath')) { i++; continue; }

    // @in"sep">>var1>>var2; または @in'sep'>>var1>>var2; 構文
    const inMatch = trimmed.match(/^@in((?:["'][^"']*["'],)*(?:["'][^"']*["']))?((?:>>[^>]+)+);$/);
    if (inMatch) {
      closeList();
      const varNames = inMatch[2].split('>>').filter(Boolean);
      const sepRaw = inMatch[1] || '';
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
      const replaceJson = JSON.stringify(replaceRules)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '&#39;');
      const sepsJson = JSON.stringify(seps).replace(/'/g, '&#39;');
      parts.push(
        `<input type="text" placeholder="${placeholder}" ` +
        `data-vars='${varNames.map(v => v.replace(/'/g, '&#39;')).join('\t')}' ` +
        `data-seps='${sepsJson}' ` +
        `data-replace='${replaceJson}' ` +
        `class="in-input" ` +
        `onkeydown="handleInInput(event)">`
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
      const maskCols = rawHeaderCells.map(cell => {
        const t = cell.trim();
        const hasMasks = t.includes('@masks');
        const hasMask  = !hasMasks && t.includes('@mask');
        const hasHide  = t.includes('@hide');
        if (hasMasks && hasHide) return 'masks+hide';
        if (hasMasks) return 'masks';
        if (hasMask)  return 'mask';
        if (hasHide)  return 'hide';
        return null;
      });
      const rowMask = maskCols.some(m => m === 'masks' || m === 'masks+hide');

      parts.push('<table><thead><tr>');
      rawHeaderCells.forEach((cell, ci) => {
        const t = cell.trim()
          .replace(/@masks/g, '')
          .replace(/@mask/g, '')
          .replace(/@hide/g, '');
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
      closeList();
      i++;
      let code = '';
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code += lines[i] + '\n';
        i++;
      }
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      parts.push(
        `<div class="code-block-wrapper">` +
        `<button class="copy-btn" onclick="copyCode(this)" aria-label="コピー">${COPY_ICON}</button>` +
        `<pre><code>${escaped}</code></pre>` +
        `</div>`
      );
      i++; continue;
    }

    if (trimmed.startsWith('> ')) {
      closeList();
      const calloutMatch = trimmed.match(/^> \[!(\w+)\]([+-])?\s*(.*)/);
      if (calloutMatch) {
        const type = calloutMatch[1].toLowerCase();
        const foldable = calloutMatch[2] === '-';
        const title = calloutMatch[3] || type;
        const color = parseCalloutColor(type);
        i++;
        // > プレフィックスを剥がした行を収集
        const bodyLines = [];
        while (i < lines.length && (lines[i].startsWith('> ') || lines[i].startsWith('>'))) {
          bodyLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        // コードブロックを含めてレンダリング
        let body = '';
        let bi = 0;
        while (bi < bodyLines.length) {
          const bl = bodyLines[bi];
          if (bl.trim().startsWith('```')) {
            bi++;
            let code = '';
            while (bi < bodyLines.length && !bodyLines[bi].trim().startsWith('```')) {
              code += bodyLines[bi] + '\n';
              bi++;
            }
            const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            body +=
              `<div class="code-block-wrapper">` +
              `<button class="copy-btn" onclick="copyCode(this)" aria-label="コピー">${COPY_ICON}</button>` +
              `<pre><code>${escaped}</code></pre>` +
              `</div>`;
            bi++; continue;
          }
          if (bl.trim() === '') { bi++; continue; }
          body += '<p>' + parseInline(bl) + '</p>';
          bi++;
        }
        const innerHtml = `<div class="callout-body">${body}</div>`;
        if (foldable) {
          parts.push(
            `<details class="callout" style="border-color:${color};">` +
            `<summary class="callout-title" style="color:${color};">${title}</summary>` +
            innerHtml +
            `</details>`
          );
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
      parts.push(`<blockquote>${parseInline(trimmed.slice(2))}</blockquote>`);
      i++; continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s(.*)/);
    if (listMatch) {
      const depth = Math.floor(listMatch[1].length / 2);
      const type = /\d+\./.test(listMatch[2]) ? 'ol' : 'ul';
      const num = type === 'ol' ? parseInt(listMatch[2], 10) : null;
      const content = listMatch[3];

      function openList(t, n) {
        const tag = t === 'ol' ? `<ol start="${n}">` : `<ul>`;
        parts.push(tag);
      }

      if (!inList) {
        openList(type, num);
        inList = [{ type, depth }];
      } else {
        const current = inList[inList.length - 1];
        if (depth > current.depth) {
          openList(type, num);
          inList.push({ type, depth });
        } else if (depth < current.depth) {
          while (inList.length > 1 && inList[inList.length - 1].depth > depth) {
            parts.push(`</${inList.pop().type}>`);
          }
          if (inList[inList.length - 1].type !== type) {
            parts.push(`</${inList.pop().type}>`);
            openList(type, num);
            inList.push({ type, depth });
          }
        } else {
          if (current.type !== type) {
            parts.push(`</${inList.pop().type}>`);
            openList(type, num);
            inList.push({ type, depth });
          }
        }
      }
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
