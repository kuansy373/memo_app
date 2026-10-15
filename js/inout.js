import { storage } from './storage.js';

export function handleInInput(event, editor, currentNote, update, checkPushStatus) {
  if (event.key !== 'Enter') return;
  if (document.querySelector('.btn-toggle').style.display === 'none') return;

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
  checkPushStatus();

  event.target.value = '';
}
