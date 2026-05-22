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
app.get('/health', (_req,res)=>res.send('101 Okey sunucusu calisiyor'));
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
EOFcat >> src/index.js << 'EOF'
io.on('connection', (socket)=>{
  socket.on('matchmaking:join', async ({bet=100}={})=>{
    const player=await getPlayer(socket.playerId);
    if(!player)return socket.emit('error:msg','Oyuncu bulunamadi');
    if(Number(player.chips)<bet)return socket.emit('error:msg','Yetersiz chip');
    const result=rooms.quickMatch({playerId:player.id,socketId:socket.id,name:player.name},bet);
    if(result.matched){
      for(const p of result.players){const s=io.sockets.sockets.get(p.socketId);if(s)s.join(result.room.id);}
      rooms.startGame(result.room.id); broadcastState(result.room.id);
    }else{socket.emit('matchmaking:waiting',{queueSize:result.queueSize});}
  });
  socket.on('room:create', async ({bet=100}={})=>{
    const player=await getPlayer(socket.playerId);
    const room=rooms.createRoom({bet,isPrivate:true});
    rooms.joinRoom(room.id,{playerId:player.id,socketId:socket.id,name:player.name});
    socket.join(room.id); socket.emit('room:created',{roomId:room.id});
  });
  socket.on('room:join', async ({roomId})=>{
    const player=await getPlayer(socket.playerId);
    const {error,room}=rooms.joinRoom(roomId,{playerId:player.id,socketId:socket.id,name:player.name});
    if(error)return socket.emit('error:msg',error);
    socket.join(roomId);
    io.to(roomId).emit('room:update',{players:room.players.map(p=>({playerId:p.playerId,name:p.name}))});
  });
  socket.on('room:start', ({roomId})=>{
    const room=rooms.getRoom(roomId);
    if(!room||room.players[0]?.playerId!==socket.playerId)return socket.emit('error:msg','Yalnizca oda sahibi baslatabilir');
    const {error}=rooms.startGame(roomId);
    if(error)return socket.emit('error:msg',error);
    broadcastState(roomId);
  });
  socket.on('game:draw', ({roomId,from='pile'})=>{
    const room=rooms.getRoom(roomId);
    if(!validTurn(room,socket.playerId,'draw'))return;
    const s=room.state; let tile;
    if(from==='pile'){
      if(s.drawPile.length===0)return socket.emit('error:msg','Deste bitti');
      tile=s.drawPile.shift();
    }else{
      const li=(s.turnOrder.indexOf(socket.playerId)-1+s.turnOrder.length)%s.turnOrder.length;
      const leftId=s.turnOrder[li]; const pile=s.discardPiles[leftId]||[];
      if(pile.length===0)return socket.emit('error:msg','Atilan tas yok');
      tile=pile.pop();
    }
    s.hands[socket.playerId].push(tile); s.phase='discard'; broadcastState(roomId);
  });
  socket.on('game:discard', ({roomId,tileId})=>{
    const room=rooms.getRoom(roomId);
    if(!validTurn(room,socket.playerId,'discard'))return;
    const s=room.state; const hand=s.hands[socket.playerId];
    const idx=hand.findIndex(t=>t.id===tileId);
    if(idx===-1)return socket.emit('error:msg','Bu tas elinde yok');
    const [tile]=hand.splice(idx,1);
    if(!s.discardPiles[socket.playerId])s.discardPiles[socket.playerId]=[];
    s.discardPiles[socket.playerId].push(tile);
    const ci=s.turnOrder.indexOf(socket.playerId);
    s.turn=s.turnOrder[(ci+1)%s.turnOrder.length]; s.phase='draw'; broadcastState(roomId);
  });
  socket.on('game:finish', async ({roomId,sets,discardTileId})=>{
    const room=rooms.getRoom(roomId);
    if(!room||room.state?.turn!==socket.playerId)return;
    const s=room.state; const alreadyOpened=!!s.openedSets[socket.playerId];
    const result=canFinish(sets,s.hands[socket.playerId],s.okey,alreadyOpened);
    if(!result.ok)return socket.emit('error:msg',result.reason);
    const last=s.hands[socket.playerId].find(t=>t.id===discardTileId);
    const finishedByOkey=last?isOkeyTile(last,s.okey):false;
    const finishedFromHand=!alreadyOpened;
    s.finished=true; s.winner=socket.playerId; s.openedSets[socket.playerId]=sets;
    const sp=room.players.map(p=>({id:p.playerId,opened:!!s.openedSets[p.playerId],hand:s.hands[p.playerId]||[]}));
    const roundScores=scoreRound({winnerId:socket.playerId,players:sp,okey:s.okey,finishedByOkey,finishedFromHand});
    s.roundScores=roundScores;
    const losers=room.players.map(p=>p.playerId).filter(id=>id!==socket.playerId);
    try{await recordGameResult(socket.playerId,losers,room.pot-room.bet);for(const lid of losers)await adjustChips(lid,-room.bet);}catch(e){console.error(e.message);}
    broadcastState(roomId);
    io.to(roomId).emit('game:over',{winner:socket.playerId,pot:room.pot,scores:roundScores,finishedByOkey,finishedFromHand});
  });
  socket.on('friend:add', async ({friendId})=>{await addFriend(socket.playerId,friendId);socket.emit('friend:ok');});
  socket.on('friend:accept', async ({friendId})=>{await acceptFriend(socket.playerId,friendId);socket.emit('friend:ok');});
  socket.on('friend:list', async ()=>{socket.emit('friend:list',await getFriends(socket.playerId));});
  socket.on('disconnect', ()=>{
    for(const room of rooms.rooms.values()){
      if(room.players.some(p=>p.playerId===socket.playerId)){
        rooms.leaveRoom(room.id,socket.playerId);
        io.to(room.id).emit('room:update',{players:room.players.map(p=>({playerId:p.playerId,name:p.name}))});
      }
    }
  });
});
initDb().then(()=>httpServer.listen(PORT,()=>console.log('Sunucu '+PORT))).catch(err=>{
  console.error('DB hatasi:',err.message);
  httpServer.listen(PORT,()=>console.log('DB yok, sunucu '+PORT));
});
