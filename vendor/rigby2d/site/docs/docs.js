// SPDX-License-Identifier: MIT OR Apache-2.0
// Documentation pages: search (search.json, built by build.js), copy buttons on code, the mobile
// table of contents and the "On this page" highlight.

import './docs.css';
import { startAnalytics } from '../../src/editor/analytics.js';

startAnalytics();

const $ = (s) => document.querySelector(s);

// ---- copy buttons ----

for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', async () => {
    const code = button.parentElement.querySelector('code').innerText;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => (button.textContent = 'Copy'), 1600);
  });
}

// ---- mobile table of contents ----

const menu = $('.menu-button');
menu?.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  menu.setAttribute('aria-expanded', String(open));
});
$('#sidebar')?.addEventListener('click', (e) => {
  if (e.target.closest('a')) document.body.classList.remove('nav-open');
});

// ---- "On this page": highlight the section being read ----

const tocLinks = [...document.querySelectorAll('.toc a')];
if (tocLinks.length) {
  const headings = tocLinks.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
  const update = () => {
    const y = window.scrollY + 120;
    let current = headings[0];
    for (const h of headings) if (h.offsetTop <= y) current = h;
    for (const a of tocLinks) a.classList.toggle('active', a.hash === `#${current?.id}`);
  };
  document.addEventListener('scroll', update, { passive: true });
  update();
}

// ---- search ----

const input = $('.search input');
const box = $('.results');
let index = null;
let hits = [];
let selected = 0;

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function loadIndex() {
  index ??= fetch(new URL('search.json', document.baseURI)).then((r) => r.json());
  return index;
}

/** Entries matching every word of `query`, best first: title, then section, then text. */
function search(entries, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const e of entries) {
    const title = e.title.toLowerCase();
    const section = e.section.toLowerCase();
    const text = e.text.toLowerCase();
    let score = 0;
    let all = true;
    for (const w of words) {
      const s = (title.includes(w) ? 8 : 0) + (section.includes(w) ? 5 : 0) + (text.includes(w) ? 1 : 0);
      if (!s) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) scored.push({ e, score: score + (e.section ? 0 : 0.5) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 12).map((s) => s.e);
}

/** A short piece of `text` around the first matching word, with the words marked. */
function snippet(text, words) {
  const lower = text.toLowerCase();
  const at = Math.max(0, Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0)) - 60);
  let s = (at ? '…' : '') + text.slice(at, at + 170) + (text.length > at + 170 ? '…' : '');
  s = escapeHtml(s);
  for (const w of words) s = s.replace(new RegExp(`(${escapeRe(escapeHtml(w))})`, 'gi'), '<mark>$1</mark>');
  return s;
}

function show() {
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    box.hidden = true;
    return;
  }
  box.replaceChildren();
  if (!hits.length) {
    box.innerHTML = '<p class="empty">No results. Try other words.</p>';
  }
  hits.forEach((e, i) => {
    const a = document.createElement('a');
    a.href = `${e.page}.html${e.id ? `#${e.id}` : ''}`;
    a.setAttribute('role', 'option');
    a.setAttribute('aria-selected', String(i === selected));
    a.innerHTML = `<b>${escapeHtml(e.title)}${e.section ? ` › ${escapeHtml(e.section)}` : ''}</b><span>${snippet(e.text, words)}</span>`;
    box.append(a);
  });
  box.hidden = false;
}

input?.addEventListener('input', async () => {
  const entries = await loadIndex();
  hits = search(entries, input.value);
  selected = 0;
  show();
});
input?.addEventListener('focus', () => {
  loadIndex();
  if (input.value) show();
});
input?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!hits.length) return;
    selected = (selected + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
    show();
    box.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    const a = box.querySelectorAll('a')[selected];
    if (a) window.location.href = a.href;
  } else if (e.key === 'Escape') {
    input.blur();
    box.hidden = true;
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.search')) box.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== input && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    input.focus();
  }
});
