const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
require('dotenv').config();
const { pool, init } = require('./db');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));

app.use((req, res, next) => {
  express.json()(req, res, next);
});

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30日
}));

app.use(passport.initialize());
app.use(passport.session());

// ----------------------------------------
// Google OAuth
// ----------------------------------------

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL || 'http://localhost:3000/auth/callback',
}, (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ログイン
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// コールバック
app.get('/auth/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failure' }),
  (req, res) => {
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:5500/root');
  }
);

app.get('/auth/failure', (req, res) => {
  res.status(401).json({ error: 'ログイン失敗' });
});

// ログアウト
app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:5500/root');
  });
});

// ログイン状態確認
app.get('/auth/status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ loggedIn: true, user: { name: req.user.displayName, email: req.user.emails[0].value } });
  } else {
    res.json({ loggedIn: false });
  }
});

// ----------------------------------------
// 認証ミドルウェア
// ----------------------------------------

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: '未ログイン' });

  if (req.user.emails[0].value !== process.env.ALLOWED_EMAIL) {
    return res.status(403).json({ error: 'アクセス権限がありません' });
  }

  next();
}

// ----------------------------------------
// API
// ----------------------------------------

// 全キー一覧
app.get('/api/notes', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT path FROM notes');
  res.json({ keys: result.rows.map(r => r.path) });
});

// ノート取得
app.get('/api/notes/*path', requireAuth, async (req, res) => {
  const path = '/' + req.params['path'].join('/');
  const result = await pool.query('SELECT content FROM notes WHERE path = $1', [path]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ path, content: result.rows[0].content });
});

// ノート保存
app.put('/api/notes/*path', requireAuth, async (req, res) => {
  const path = '/' + req.params['path'].join('/');
  const { content } = req.body;
  await pool.query(
    'INSERT INTO notes (path, content) VALUES ($1, $2) ON CONFLICT (path) DO UPDATE SET content = $2, updated_at = NOW()',
    [path, content]
  );
  res.json({ path, content });
});

// ノート削除
app.delete('/api/notes/*path', requireAuth, async (req, res) => {
  const path = '/' + req.params['path'].join('/');
  await pool.query('DELETE FROM notes WHERE path = $1', [path]);
  res.json({ path });
});

// 全ノート一括取得
app.get('/api/sync', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT path, content, updated_at FROM notes');
  res.json({ notes: result.rows });
});

// 全ノート一括保存
app.post('/api/sync', requireAuth, async (req, res) => {
  const { notes } = req.body;
  let last_updated;
  for (const [path, content] of Object.entries(notes)) {
    const result = await pool.query(
      'INSERT INTO notes (path, content) VALUES ($1, $2) ON CONFLICT (path) DO UPDATE SET content = $2, updated_at = NOW() RETURNING updated_at',
      [path, content]
    );
    last_updated = result.rows[0].updated_at;
  }
  res.json({ ok: true, last_updated });
});

// 最終更新時刻を取得
app.get('/api/sync/status', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT MAX(updated_at) as last_updated FROM notes');
  res.json({ last_updated: result.rows[0].last_updated });
});

// ----------------------------------------
// 起動
// ----------------------------------------

const PORT = process.env.PORT || 3000;
init().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
