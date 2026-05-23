// ============================================================
//  VERİTABANI KATMANI
//  DATABASE_URL varsa PostgreSQL kullanır.
//  Yoksa otomatik olarak bellek-içi (in-memory) moda geçer.
//  Böylece veritabanı bağlanmadan da oyun tam çalışır.
//  (Bellek modunda veriler sunucu yeniden başlayınca sıfırlanır.)
// ============================================================
import pg from 'pg';

const HAS_DB = !!process.env.DATABASE_URL;

let pool = null;
if (HAS_DB) {
  const { Pool } = pg;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
  });
}

// ---------------- BELLEK-İÇİ DEPO (DB yoksa) ----------------
const mem = {
  players: new Map(),
  friends: [],
};

export async function initDb() {
  if (!HAS_DB) {
    console.log('DATABASE_URL yok - bellek-ici mod aktif (oyun calisir, veriler kalici degil)');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      chips       BIGINT NOT NULL DEFAULT 1000,
      games_won   INT NOT NULL DEFAULT 0,
      games_played INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS friends (
      player_id   TEXT NOT NULL REFERENCES players(id),
      friend_id   TEXT NOT NULL REFERENCES players(id),
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, friend_id)
    );
  `);
  console.log('Veritabani tablolari hazir');
}

export async function getOrCreatePlayer(id, name) {
  if (!HAS_DB) {
    let p = mem.players.get(id);
    if (p) { p.name = name; }
    else {
      p = { id, name, chips: 1000, games_won: 0, games_played: 0, created_at: new Date().toISOString() };
      mem.players.set(id, p);
    }
    return { ...p };
  }
  const res = await pool.query(
    `INSERT INTO players (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [id, name]
  );
  return res.rows[0];
}

export async function getPlayer(id) {
  if (!HAS_DB) {
    const p = mem.players.get(id);
    return p ? { ...p } : undefined;
  }
  const res = await pool.query('SELECT * FROM players WHERE id = $1', [id]);
  return res.rows[0];
}

export async function adjustChips(id, delta) {
  if (!HAS_DB) {
    const p = mem.players.get(id);
    if (!p) return undefined;
    p.chips = Number(p.chips) + Number(delta);
    return p.chips;
  }
  const res = await pool.query(
    `UPDATE players SET chips = chips + $2 WHERE id = $1 RETURNING chips`,
    [id, delta]
  );
  return res.rows[0]?.chips;
}

export async function recordGameResult(winnerId, loserIds, pot) {
  if (!HAS_DB) {
    const w = mem.players.get(winnerId);
    if (w) { w.chips = Number(w.chips) + Number(pot); w.games_won += 1; w.games_played += 1; }
    for (const lid of loserIds) {
      const l = mem.players.get(lid);
      if (l) l.games_played += 1;
    }
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE players SET chips = chips + $2, games_won = games_won + 1,
       games_played = games_played + 1 WHERE id = $1`,
      [winnerId, pot]
    );
    for (const lid of loserIds) {
      await client.query(
        `UPDATE players SET games_played = games_played + 1 WHERE id = $1`,
        [lid]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getLeaderboard(limit = 50) {
  if (!HAS_DB) {
    return [...mem.players.values()]
      .sort((a, b) => Number(b.chips) - Number(a.chips))
      .slice(0, limit)
      .map(p => ({ id: p.id, name: p.name, chips: p.chips, games_won: p.games_won, games_played: p.games_played }));
  }
  const res = await pool.query(
    `SELECT id, name, chips, games_won, games_played
     FROM players ORDER BY chips DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function addFriend(playerId, friendId) {
  if (!HAS_DB) {
    const exists = mem.friends.find(f => f.player_id === playerId && f.friend_id === friendId);
    if (!exists) mem.friends.push({ player_id: playerId, friend_id: friendId, status: 'pending' });
    return;
  }
  await pool.query(
    `INSERT INTO friends (player_id, friend_id, status) VALUES ($1, $2, 'pending')
     ON CONFLICT DO NOTHING`,
    [playerId, friendId]
  );
}

export async function acceptFriend(playerId, friendId) {
  if (!HAS_DB) {
    const f1 = mem.friends.find(f => f.player_id === friendId && f.friend_id === playerId);
    if (f1) f1.status = 'accepted';
    let f2 = mem.friends.find(f => f.player_id === playerId && f.friend_id === friendId);
    if (f2) f2.status = 'accepted';
    else mem.friends.push({ player_id: playerId, friend_id: friendId, status: 'accepted' });
    return;
  }
  await pool.query(
    `UPDATE friends SET status='accepted' WHERE player_id=$2 AND friend_id=$1`,
    [playerId, friendId]
  );
  await pool.query(
    `INSERT INTO friends (player_id, friend_id, status) VALUES ($1,$2,'accepted')
     ON CONFLICT (player_id, friend_id) DO UPDATE SET status='accepted'`,
    [playerId, friendId]
  );
}

export async function getFriends(playerId) {
  if (!HAS_DB) {
    return mem.friends
      .filter(f => f.player_id === playerId)
      .map(f => {
        const p = mem.players.get(f.friend_id);
        return p ? { id: p.id, name: p.name, chips: p.chips, status: f.status } : null;
      })
      .filter(Boolean);
  }
  const res = await pool.query(
    `SELECT p.id, p.name, p.chips, f.status
     FROM friends f JOIN players p ON p.id = f.friend_id
     WHERE f.player_id = $1`,
    [playerId]
  );
  return res.rows;
}

export { pool };
