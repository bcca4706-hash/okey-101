const COLORS = ['red','yellow','black','blue'];
const NUMBERS = Array.from({length:13},(_,i)=>i+1);
export function buildDeck(){
  const deck=[]; let id=0;
  for(const color of COLORS){for(const num of NUMBERS){
    deck.push({id:id++,color,num,fake:false});
    deck.push({id:id++,color,num,fake:false});
  }}
  deck.push({id:id++,color:null,num:null,fake:true});
  deck.push({id:id++,color:null,num:null,fake:true});
  return deck;
}
export function shuffle(deck){
  const a=[...deck];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
export function determineOkey(ind){
  const num=ind.num===13?1:ind.num+1;
  return {color:ind.color,num};
}
export function dealGame(order){
  const deck=shuffle(buildDeck());
  let ii=deck.findIndex(t=>!t.fake);
  const indicator=deck.splice(ii,1)[0];
  const okey=determineOkey(indicator);
  const hands={};
  for(const pid of order){hands[pid]=deck.splice(0,14);}
  hands[order[0]].push(deck.shift());
  return {drawPile:deck,discardPiles:{},indicator,okey,hands,turn:order[0],turnOrder:order,phase:'draw',openedSets:{},finished:false,winner:null};
}
export function isOkeyTile(t,okey){
  if(t.fake)return true;
  return t.color===okey.color&&t.num===okey.num;
}
function validateGroup(tiles,okey){
  if(tiles.length<3||tiles.length>4)return false;
  const reals=tiles.filter(t=>!isOkeyTile(t,okey));
  const jokers=tiles.length-reals.length;
  if(reals.length===0)return false;
  const num=reals[0].num; const colors=new Set();
  for(const t of reals){if(t.num!==num)return false;if(colors.has(t.color))return false;colors.add(t.color);}
  return reals.length+jokers<=4;
}
function validateRun(tiles,okey){
  if(tiles.length<3)return false;
  const reals=tiles.filter(t=>!isOkeyTile(t,okey));
  let jokers=tiles.length-reals.length;
  if(reals.length===0)return false;
  const color=reals[0].color;
  for(const t of reals)if(t.color!==color)return false;
  const nums=reals.map(t=>t.num).sort((a,b)=>a-b);
  for(let i=1;i<nums.length;i++){
    if(nums[i]===nums[i-1])return false;
    const gap=nums[i]-nums[i-1]-1;
    if(gap>jokers)return false; jokers-=gap;
  }
  return true;
}
export function validateSet(tiles,okey){
  return validateGroup(tiles,okey)||validateRun(tiles,okey);
}
export function setValue(tiles,okey){
  const reals=tiles.filter(t=>!isOkeyTile(t,okey));
  if(reals.length===0)return 0;
  if(validateGroup(tiles,okey)){return reals[0].num*tiles.length;}
  if(validateRun(tiles,okey)){
    const nums=reals.map(t=>t.num).sort((a,b)=>a-b);
    let total=nums.reduce((a,b)=>a+b,0);
    let jokers=tiles.length-reals.length;
    for(let i=1;i<nums.length;i++){let gap=nums[i]-nums[i-1]-1;while(gap>0&&jokers>0){total+=nums[i]-gap;gap--;jokers--;}}
    let high=Math.max(...nums);while(jokers>0&&high<13){high++;total+=high;jokers--;}
    let low=Math.min(...nums);while(jokers>0&&low>1){low--;total+=low;jokers--;}
    return total;
  }
  return 0;
}
export function totalSetsValue(sets,okey){return sets.reduce((s,x)=>s+setValue(x,okey),0);}
export function canFinish(sets,hand,okey,alreadyOpened=false){
  for(const s of sets){if(!validateSet(s,okey))return {ok:false,reason:'Gecersiz per'};}
  const used=new Set(sets.flat().map(t=>t.id));
  if(used.size!==hand.length-1)return {ok:false,reason:'Tum taslar perlere dahil degil'};
  if(!alreadyOpened){const v=totalSetsValue(sets,okey);if(v<101)return {ok:false,reason:'Acilis icin en az 101 gerekli'};}
  return {ok:true};
}
export function handPenalty(hand,okey){
  return hand.reduce((s,t)=>{if(t.fake||isOkeyTile(t,okey))return s+(okey?okey.num:0);return s+t.num;},0);
}
export function scoreRound({winnerId,players,okey,finishedByOkey=false,finishedFromHand=false}){
  const scores={};
  let openFail; if(finishedByOkey)openFail=808;else if(finishedFromHand)openFail=404;else openFail=202;
  let winnerScore=finishedFromHand?-202:-101;
  for(const p of players){
    if(p.id===winnerId)scores[p.id]=winnerScore;
    else if(!p.opened)scores[p.id]=openFail;
    else{const base=handPenalty(p.hand,okey);scores[p.id]=finishedByOkey?base*2:base;}
  }
  return scores;
}
