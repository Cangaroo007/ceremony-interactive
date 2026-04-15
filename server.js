const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

for (const dir of [DATA_DIR, PHOTOS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load state:', e.message);
  }
  return { translation: null, photoIds: [] };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasKey: !!anthropic, photos: state.photoIds.length });
});

app.get('/api/state', (req, res) => {
  res.json(state);
});

app.post('/api/translate', async (req, res) => {
  const { text, sourceLang } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text required' });
  }
  if (!anthropic) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  const source = sourceLang === 'en' ? 'English' : 'Japanese';
  const target = sourceLang === 'en' ? 'Japanese' : 'English';

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are a real-time translator for a wedding ceremony. Translate from ${source} to ${target} with warmth, elegance, and reverence appropriate for a wedding. Output ONLY the translation — no explanations, no quotes, no labels.`,
      messages: [{ role: 'user', content: text }],
    });

    const translated = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    state.translation = {
      original: text,
      translated,
      sourceLang: sourceLang === 'en' ? 'en' : 'ja',
      targetLang: sourceLang === 'en' ? 'ja' : 'en',
      timestamp: Date.now(),
    };
    saveState(state);
    res.json(state.translation);
  } catch (e) {
    console.error('Translate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/photos', (req, res) => {
  res.json({ photoIds: state.photoIds });
});

app.get('/api/photos/:id', (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const file = path.join(PHOTOS_DIR, `${id}.txt`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  const base64 = fs.readFileSync(file, 'utf8');
  res.json({ id, dataUrl: base64 });
});

app.post('/api/photos', (req, res) => {
  const { dataUrl } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'dataUrl required' });
  }
  const id = crypto.randomBytes(8).toString('hex');
  const file = path.join(PHOTOS_DIR, `${id}.txt`);
  fs.writeFileSync(file, dataUrl);
  state.photoIds.push(id);
  saveState(state);
  res.json({ id });
});

app.post('/api/reset', (req, res) => {
  state = { translation: null, photoIds: [] };
  saveState(state);
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌸 Wedding Translator running on port ${PORT}`);
  console.log(`   ANTHROPIC_API_KEY: ${anthropic ? 'set ✓' : 'NOT SET ✗'}`);
  console.log(`   Open: http://localhost:${PORT}\n`);
});
