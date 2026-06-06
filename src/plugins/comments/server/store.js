import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { ROOT_DIR } from '../../../core/server/config.js';

const COMMENTS_DIR = path.join(ROOT_DIR, 'data', 'comments');

async function ensureDir() {
  if (!existsSync(COMMENTS_DIR)) {
    await mkdir(COMMENTS_DIR, { recursive: true });
  }
}

function jsonFile(file) {
  const base = path.basename(file, '.md');
  return path.join(COMMENTS_DIR, `${base}.json`);
}

export async function loadComments(file) {
  await ensureDir();
  const jf = jsonFile(file);
  if (!existsSync(jf)) return { file, comments: [] };
  try {
    return JSON.parse(await readFile(jf, 'utf-8'));
  } catch {
    return { file, comments: [] };
  }
}

export async function saveComments(file, data) {
  await ensureDir();
  await writeFile(jsonFile(file), JSON.stringify(data, null, 2), 'utf-8');
}

// Return chapters that have at least one comment, with count and latest timestamp.
// Each entry: { file, count, latestAt }
// file is the chapter filename (e.g. "01-概述.md") reconstructed from the JSON basename.
export async function getCommentSummary() {
  await ensureDir();
  const chapters = [];
  let entries;
  try {
    entries = await readdir(COMMENTS_DIR);
  } catch {
    return chapters;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const jsonPath = path.join(COMMENTS_DIR, entry);
    let data;
    try {
      data = JSON.parse(await readFile(jsonPath, 'utf-8'));
    } catch {
      continue;
    }
    if (!data || !Array.isArray(data.comments) || data.comments.length === 0) continue;
    const base = entry.replace(/\.json$/, '');
    // Reconstruct chapter filename: the stored JSON basename is the chapter basename without .md
    const file = base + '.md';
    let latestAt = '';
    for (const c of data.comments) {
      if (c.createdAt && c.createdAt > latestAt) latestAt = c.createdAt;
    }
    chapters.push({ file, count: data.comments.length, latestAt });
  }
  // Sort by latestAt descending so most recently commented chapters appear first
  chapters.sort((a, b) => {
    if (a.latestAt > b.latestAt) return -1;
    if (a.latestAt < b.latestAt) return 1;
    return 0;
  });
  return chapters;
}
