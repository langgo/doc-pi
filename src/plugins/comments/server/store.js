import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../../../core/server/runtime-state.js';

function commentsDir() {
  return getRuntimeConfig().comments.dataDir;
}

async function ensureDir() {
  const dir = commentsDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

function jsonFile(file) {
  // Preserve directory structure: subdir/file.md → subdir/file.json
  const base = file.replace(/\.md$/, '');
  return path.join(commentsDir(), `${base}.json`);
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
  const jf = jsonFile(file);
  const dir = path.dirname(jf);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(jf, JSON.stringify(data, null, 2), 'utf-8');
}

// Return chapters that have at least one comment, with count and latest timestamp.
// Each entry: { file, count, latestAt }
// file is the chapter filename (e.g. "01-概述.md" or "subdir/01-概述.md") reconstructed from the JSON path.
export async function getCommentSummary() {
  await ensureDir();
  const chapters = [];

  async function scanDir(dir, prefix = '') {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await scanDir(path.join(dir, entry.name), prefix + entry.name + '/');
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const jsonPath = path.join(dir, entry.name);
        let data;
        try {
          data = JSON.parse(await readFile(jsonPath, 'utf-8'));
        } catch {
          continue;
        }
        if (!data || !Array.isArray(data.comments) || data.comments.length === 0) continue;
        const base = entry.name.replace(/\.json$/, '');
        const file = prefix + base + '.md';
        let latestAt = '';
        for (const c of data.comments) {
          if (c.createdAt && c.createdAt > latestAt) latestAt = c.createdAt;
        }
        chapters.push({ file, count: data.comments.length, latestAt });
      }
    }
  }

  await scanDir(commentsDir());

  // Sort by latestAt descending so most recently commented chapters appear first
  chapters.sort((a, b) => {
    if (a.latestAt > b.latestAt) return -1;
    if (a.latestAt < b.latestAt) return 1;
    return 0;
  });
  return chapters;
}
