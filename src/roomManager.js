import { nanoid } from 'nanoid';
import { dealGame } from './okeyGame.js';
export class RoomManager{
  constructor(){this.rooms=new Map();this.waitingQueue=[];}
  createRoom({maxPlayers=4,bet=100,isPrivate=false}={}){
    const roomId=nanoid(8);
    const room={id:roomId,players:[],maxPlayers,bet,isPrivate,state:null,status:'waiting',pot:0};
    this.rooms.set(roomId,room); return room;
  }
  getRoom(roomId){return this.rooms.get(roomId);}
  joinRoom(roomId,player){
    const room=this.rooms.get(roomId);
    if(!room)return {error:'Oda bulunamadi'};
    if(room.status!=='waiting')return {error:'Oyun coktan basladi'};
    if(room.players.length>=room.maxPlayers)return {error:'Oda dolu'};
    if(room.players.some(p=>p.playerId===player.playerId))return {error:'Zaten bu odadasin'};
    room.players.push({...player,ready:false}); return {room};
  }
  leaveRoom(roomId,playerId){
    const room=this.rooms.get(roomId);
    if(!room)return;
    room.players=room.players.filter(p=>p.playerId!==playerId);
    if(room.players.length===0)this.rooms.delete(roomId);
    return room;
  }
  quickMatch(player,bet=100){
    this.waitingQueue.push({...player,bet});
    const sameBet=this.waitingQueue.filter(p=>p.bet===bet);
    if(sameBet.length>=4){
      const matched=sameBet.slice(0,4);
      const ids=new Set(matched.map(p=>p.playerId));
      this.waitingQueue=this.waitingQueue.filter(p=>!ids.has(p.playerId));
      const room=this.createRoom({bet});
      matched.forEach(p=>room.players.push({...p,ready:true}));
      return {matched:true,room,players:matched};
    }
    return {matched:false,queueSize:sameBet.length};
  }
  startGame(roomId){
    const room=this.rooms.get(roomId);
    if(!room)return {error:'Oda yok'};
    if(room.players.length<2)return {error:'En az 2 oyuncu gerekli'};
    const order=room.players.map(p=>p.playerId);
    room.state=dealGame(order); room.status='playing'; room.pot=room.bet*room.players.length;
    return {room};
  }
  publicStateFor(room,playerId){
    const s=room.state; if(!s)return null;
    return {roomId:room.id,indicator:s.indicator,okey:s.okey,turn:s.turn,phase:s.phase,
      drawPileCount:s.drawPile.length,discardPiles:s.discardPiles,openedSets:s.openedSets,
      finished:s.finished,winner:s.winner,myHand:s.hands[playerId]||[],
      players:room.players.map(p=>({playerId:p.playerId,name:p.name,tileCount:(s.hands[p.playerId]||[]).length}))};
  }
}
