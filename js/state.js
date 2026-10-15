export let currentMode = 'preview';
export let preDiffMode = 'preview';
export const lastSyncedMap = new Map();
export const pullNotes = new Set();

export function setCurrentMode(mode) { currentMode = mode; }
export function setPreDiffMode(mode) { preDiffMode = mode; }
