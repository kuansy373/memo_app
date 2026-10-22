const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
require('dotenv').config();
const { pool, init } = require('./db');

// ----------------------------------------
// 環境変数チェック
// ----------------------------------------

const REQUIRED_ENV = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'CALLBACK_URL',
  'SESSION_SECRET',
  'FRONTEND_URL',
  'FRONTEND_ORIGIN',
  'ALLOWED_EMAIL',
  'PORT',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`環境変数 ${key} が設定されていません`);
}

// ----------------------------------------
// アプリ設定
// ----------------------------------------

const app = express();

app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN,
  credentials: true,
}));

app.use(express.json());

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// ----------------------------------------
// Google OAuth
// ----------------------------------------

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL,
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
    // ここでメールアドレスを確認する
    const email = req.user?.emails?.[0]?.value;
    if (email !== process.env.ALLOWED_EMAIL) {
      req.logout(() => {
        // フロントへリダイレクト時にエラーを伝えるクエリパラメータを付ける
        res.redirect(`${process.env.FRONTEND_URL}?error=unauthorized_email`);
      });
      return;
    }
    res.redirect(process.env.FRONTEND_URL);
  }
);

app.get('/auth/failure', (req, res) => {
  res.status(401).json({ error: 'ログイン失敗' });
});

// ログアウト
app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    res.redirect(process.env.FRONTEND_URL);
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

// ノート取得
app.get('/api/notes/*path', requireAuth, async (req, res) => {
  const path = '/' + req.params['path'].join('/');
  const result = await pool.query('SELECT content FROM notes WHERE path = $1', [path]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ path, content: result.rows[0].content });
});

// ノート保存（空コンテンツの場合は削除扱い）
app.put('/api/notes/*path', requireAuth, async (req, res) => {
  const path = '/' + req.params['path'].join('/');
  const { content } = req.body;
  if (content === '' || content == null) {
    await pool.query('DELETE FROM notes WHERE path = $1', [path]);
    return res.json({ path, deleted: true });
  }
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

// ノートのパス一括リネーム（名前変更時に旧path群→新path群へ UPDATE）
app.post('/api/notes/rename', requireAuth, async (req, res) => {
  const { oldPath, newPath } = req.body;

  if (!oldPath || !newPath) {
    return res.status(400).json({ error: 'oldPath and newPath are required' });
  }

  // oldPath 自身と、oldPath/ で始まる子ノート全てを対象に UPDATE
  // 例: /home/old → /home/new, /home/old/child → /home/new/child
  const result = await pool.query(
    `UPDATE notes
     SET path = $2 || substring(path from length($1) + 1),
         updated_at = NOW()
     WHERE path = $1 OR path LIKE $3`,
    [oldPath, newPath, oldPath + '/%']
  );

  res.json({ ok: true, updated: result.rowCount });
});

// ----------------------------------------
// 静的ファイル配信 & SPA フォールバック
//（ローカル開発用。APIルートより後に書いているので、本番ではこのコードは実行されない。）
// ----------------------------------------

// フロントのファイルをそのまま配信（memo_app/ 直下を想定）
app.use('/memo_app', express.static(path.join(__dirname, '..')));

// APIにマッチしなかったパスはすべて index.html を返す（SPAルーティング）
app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ----------------------------------------
// 起動
// ----------------------------------------

const PORT = process.env.PORT;
init().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
