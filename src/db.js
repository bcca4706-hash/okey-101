import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized:false },
});
export async function initDb(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      chips BIGINT NOT NULL DEFAULT 1000,
      games_won INT NOT NULL DEFAULT 0,
      games_played INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS friends (
      player_id TEXT NOT NULL REFERENCES players(id),
      friend_id TEXT NOT NULL REFERENCES players(id),
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, friend_id)
    );
  `);
  console.log('DB hazir');
}
export async function getOrCreatePlayer(id,name){
  const r=await pool.query(`INSERT INTO players (id,name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name RETURNING *`,[id,name]);
  return r.rows[0];
}
export async function getPlayer(id){
  const r=await pool.query('SELECT * FROM players WHERE id=$1',[id]); return r.rows[0];
}
export async function adjustChips(id,delta){
  const r=await pool.query(`UPDATE players SET chips=chips+$2 WHERE id=$1 RETURNING chips`,[id,delta]);
  return r.rows[0]?.chips;
}
export async function recordGameResult(winnerId,loserIds,pot){
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query(`UPDATE players SET chips=chips+$2,games_won=games_won+1,games_played=games_played+1 WHERE id=$1`,[winnerId,pot]);
    for(const lid of loserIds){await c.query(`UPDATE players SET games_played=games_played+1 WHERE id=$1`,[lid]);}
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function getLeaderboard(limit=50){
  const r=await pool.query(`SELECT id,name,chips,games_won,games_played FROM players ORDER BY chips DESC LIMIT $1`,[limit]);
  return r.rows;
}
export async function addFriend(playerId,friendId){
  await pool.query(`INSERT INTO friends (player_id,friend_id,status) VALUES ($1,$2,'pending') ON CONFLICT DO NOTHING`,[playerId,friendId]);
}
export async function acceptFriend(playerId,friendId){
  await pool.query(`UPDATE friends SET status='accepted' WHERE player_id=$2 AND friend_id=$1`,[playerId,friendId]);
  await pool.query(`INSERT INTO friends (player_id,friend_id,status) VALUES ($1,$2,'accepted') ON CONFLICT (player_id,friend_id) DO UPDATE SET status='accepted'`,[playerId,friendId]);
}
export async function getFriends(playerId){
  const r=await pool.query(`SELECT p.id,p.name,p.chips,f.status FROM friends f JOIN players p ON p.id=f.friend_id WHERE f.player_id=$1`,[playerId]);
  return r.rows;
}
export { pool };
