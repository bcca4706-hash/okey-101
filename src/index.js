import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { RoomManager } from './roomManager.js';
import { validateSet, canFinish, isOkeyTile, scoreRound } from './okeyGame.js';
import { initDb, getOrCreatePlayer, getPlayer, adjustChips, recordGameResult, getLeaderboard, addFriend, acceptFriend, getFriends } from './db.js';
const JWT_SECRET = process.env.JWT_SECRET || 'degistir-bu-anahtari';
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.use(express.static('public'));
const httpServer = createServer(app);
const io = new Server(httpServer, { cors:{ origin:'*' } });
const rooms = new RoomManager();
app.get('/health', (_req,res)=>res.send('101 Okey calisiyor'));
app.post('/auth/guest', async (req,res)=>{
  try{
    const name=(req.body?.name||'Oyuncu').slice(0,20);
    const id=req.body?.id||nanoid(12);
    const player=await getOrCreatePlayer(id,name);
    const token=jwt.sign({id:player.id},JWT_SECRET,{expiresIn:'30d'});
    res.json({token,player});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/leaderboard', async (_req,res)=>{ res.json(await getLeaderboard()); });
function verifyToken(token){try{return jwt.verify(token,JWT_SECRET);}catch{return null;}}
io.use((socket,next)=>{
  const token=socket.handshake.auth?.token;
  const payload=verifyToken(token);
  if(!payload)return next(new Error('Yetkisiz'));
  socket.playerId=payload.id; next();
});
function validTurn(room,playerId,phase){
  if(!room||!room.state)return false;
  if(room.state.turn!==playerId)return false;
  if(room.state.phase!==phase)return false;
  if(room.state.finished)return false;
  return true;
}
function broadcastState(roomId){
  const room=rooms.getRoom(roomId); if(!room)return;
  for(const p of room.players){
    const s=io.sockets.sockets.get(p.socketId);
    if(s)s.emit('game:state',rooms.publicStateFor(room,p.playerId));
  }
}
httpServer.listen(PORT, () => {
  console.log('Sunucu calisiyor port '+PORT);
  initDb().then(()=>console.log('DB hazir')).catch(err=>console.error('DB yok (oyun yine calisir):',err.message));
});
