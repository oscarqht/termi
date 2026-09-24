import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MAX_RECENT_CWDS = 15;

export function getRecentCwdsFilePath() {
  return path.join(os.homedir(), '.termi', 'recent_cwds.json');
}

export function resolveCwd(p) {
  if (!p || typeof p !== 'string') return '';
  const trimmed = p.trim();
  if (!trimmed) return '';
  const expanded = trimmed.startsWith('~')
    ? trimmed.replace(/^~/, os.homedir())
    : trimmed;
  return path.resolve(expanded);
}

export async function ensureTermiDir() {
  const dir = path.join(os.homedir(), '.termi');
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch {}
}

export async function loadRecentCwds() {
  const filePath = getRecentCwdsFilePath();
  let raw = '';
  try {
    raw = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    return [];
  }

  let list;
  try {
    list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
  } catch {
    return [];
  }

  // Validate existence and prune non-existent directories
  const valid = [];
  let changed = false;
  for (const item of list) {
    if (typeof item !== 'string' || !item.trim()) {
      changed = true;
      continue;
    }
    const resolved = resolveCwd(item);
    try {
      const stat = await fsp.stat(resolved);
      if (stat.isDirectory()) {
        if (!valid.includes(resolved)) {
          valid.push(resolved);
        } else {
          changed = true;
        }
      } else {
        changed = true;
      }
    } catch {
      changed = true;
    }
  }

  if (valid.length > MAX_RECENT_CWDS) {
    valid.splice(MAX_RECENT_CWDS);
    changed = true;
  }

  if (changed) {
    await saveRecentCwds(valid);
  }

  return valid;
}

export async function saveRecentCwds(cwds) {
  await ensureTermiDir();
  const filePath = getRecentCwdsFilePath();
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  const data = JSON.stringify(cwds.slice(0, MAX_RECENT_CWDS), null, 2);
  await fsp.writeFile(tempPath, data, 'utf8');
  await fsp.rename(tempPath, filePath);
}

export async function addRecentCwd(targetPath) {
  const resolved = resolveCwd(targetPath);
  if (!resolved) return loadRecentCwds();

  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isDirectory()) {
      return loadRecentCwds();
    }
  } catch {
    return loadRecentCwds();
  }

  const current = await loadRecentCwds();
  const next = [resolved, ...current.filter((p) => p !== resolved)].slice(0, MAX_RECENT_CWDS);
  await saveRecentCwds(next);
  return next;
}

export async function removeRecentCwd(targetPath) {
  const resolved = resolveCwd(targetPath);
  const current = await loadRecentCwds();
  const next = current.filter((p) => p !== resolved && p !== targetPath);
  await saveRecentCwds(next);
  return next;
}
