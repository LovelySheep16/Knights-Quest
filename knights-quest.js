const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let W, H, tileSize = 48;
function resize(){ W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
resize(); window.addEventListener('resize', resize);

const TILE = { FLOOR:0, WALL:1, STAIR:2, SHOP:3 };
let gameState='menu', level=1, player, monsters, map, effects, keys={}, attackCooldown=0, frameCount=0, shopOpen=false;
let potionCount=0, regenTimer=0;
const REGEN_INTERVAL=20*60, REGEN_AMOUNT=10;

const UPGRADES = [
  { id:'sword',  name:'Iron Sword',    desc:'+3 Attack power',           cost:40, stat:'atk',   val:3,   maxLevel:4,   icon:'⚔' },
  { id:'shield', name:'Shield',        desc:'+20 Max HP',                cost:35, stat:'maxHp', val:20,  maxLevel:4,   icon:'🛡' },
  { id:'boots',  name:'Swift Boots',   desc:'+0.5 Speed',                cost:45, stat:'spd',   val:0.5, maxLevel:3,   icon:'👟' },
  { id:'armor',  name:'Plate Armor',   desc:'-1 damage taken',           cost:50, stat:'def',   val:1,   maxLevel:4,   icon:'🥋' },
  { id:'potion', name:'Health Potion', desc:'+10 HP regen every 20 sec', cost:50, stat:'potion',val:0,   maxLevel:999, icon:'🧪' },
];
let upgradeLevels={};

function initPlayer(){
  return { x:2*tileSize+tileSize/2, y:2*tileSize+tileSize/2, w:28, h:32,
    hp:100, maxHp:100, atk:8, def:0, spd:2.5, coins:0,
    facing:0, isAttacking:false, attackTimer:0, hitFlash:0 };
}

const MONSTER_TYPES=[
  {name:'Slime',    color:'#44cc44', hp:30,  maxHp:30,  atk:4,  spd:0.8, reward:10, size:22, aggro:120, shape:'slime'},
  {name:'Skeleton', color:'#ccccaa', hp:55,  maxHp:55,  atk:8,  spd:1.2, reward:22, size:26, aggro:160, shape:'skeleton'},
  {name:'Goblin',   color:'#88cc44', hp:45,  maxHp:45,  atk:6,  spd:1.6, reward:18, size:24, aggro:140, shape:'goblin'},
  {name:'Orc',      color:'#cc8844', hp:90,  maxHp:90,  atk:14, spd:0.9, reward:40, size:30, aggro:180, shape:'orc'},
  {name:'Dragon',   color:'#cc4444', hp:180, maxHp:180, atk:22, spd:1.0, reward:90, size:36, aggro:200, shape:'dragon'},
];

function getMonsterPool(){ if(level===1)return[0,0,1];if(level===2)return[1,2,2];if(level===3)return[2,3,3];return[2,3,4]; }

function generateMap(){
  let cols=Math.floor(W/tileSize),rows=Math.floor(H/tileSize),grid=[];
  for(let r=0;r<rows;r++){grid[r]=[];for(let c=0;c<cols;c++)grid[r][c]=(r===0||r===rows-1||c===0||c===cols-1)?TILE.WALL:TILE.FLOOR;}
  for(let i=0;i<6+level*2;i++){
    let wr=3+Math.floor(Math.random()*(rows-6)),wc=3+Math.floor(Math.random()*(cols-6)),wl=2+Math.floor(Math.random()*4),horiz=Math.random()>0.5;
    for(let j=0;j<wl;j++){let r2=horiz?wr:Math.min(wr+j,rows-2),c2=horiz?Math.min(wc+j,cols-2):wc;if(r2>2&&c2>2)grid[r2][c2]=TILE.WALL;}
  }
  // Flood fill from player spawn to find every reachable floor tile
  let reach=Array.from({length:rows},()=>new Array(cols).fill(false));
  let q=[[2,2]];reach[2][2]=true;
  while(q.length){let[r,c]=q.shift();[[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc])=>{let nr=r+dr,nc=c+dc;if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&!reach[nr][nc]&&grid[nr][nc]===TILE.FLOOR){reach[nr][nc]=true;q.push([nr,nc]);}});}
  // Seal any floor tile that is cut off by walls so no unreachable pockets exist
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)if(!reach[r][c]&&grid[r][c]===TILE.FLOOR)grid[r][c]=TILE.WALL;
  // Place stair on the reachable floor tile closest to bottom-right corner
  let best=Infinity,stR=rows-3,stC=cols-3;
  for(let r=1;r<rows-1;r++)for(let c=1;c<cols-1;c++)if(reach[r][c]){let d=Math.abs(r-(rows-3))+Math.abs(c-(cols-3));if(d<best){best=d;stR=r;stC=c;}}
  grid[stR][stC]=TILE.STAIR;
  // Place shop on the reachable floor tile closest to bottom-left corner
  best=Infinity;let spR=rows-3,spC=2;
  for(let r=1;r<rows-1;r++)for(let c=1;c<cols-1;c++)if(reach[r][c]&&!(r===stR&&c===stC)){let d=Math.abs(r-(rows-3))+Math.abs(c-2);if(d<best){best=d;spR=r;spC=c;}}
  grid[spR][spC]=TILE.SHOP;
  // Build list of reachable floor tiles for monster spawning
  let floorTiles=[];
  for(let r=1;r<rows-1;r++)for(let c=1;c<cols-1;c++)if(reach[r][c]&&grid[r][c]===TILE.FLOOR)floorTiles.push({x:c*tileSize+tileSize/2,y:r*tileSize+tileSize/2});
  return {grid,cols,rows,floorTiles};
}

function spawnMonsters(){
  let pool=getMonsterPool(),count=4+level*2,list=[];
  let farTiles=(map.floorTiles||[]).filter(t=>Math.abs(t.x-player.x)>=150||Math.abs(t.y-player.y)>=150);
  if(!farTiles.length)farTiles=map.floorTiles||[];
  for(let i=0;i<count;i++){
    let typeIdx=pool[Math.floor(Math.random()*pool.length)],type=Object.assign({},MONSTER_TYPES[typeIdx]);
    type.hp=type.maxHp=type.hp+(level-1)*10; type.atk=type.atk+(level-1)*2; type.reward=type.reward+(level-1)*5;
    let t=farTiles[Math.floor(Math.random()*farTiles.length)]||{x:player.x+200,y:player.y+200};
    list.push({...type,x:t.x,y:t.y,facing:0,hitFlash:0,atkCool:0,moveTimer:Math.random()*60,wanderDx:0,wanderDy:0});
  }
  return list;
}

function startGame(){
  document.getElementById('overlay').style.display='none';
  gameState='playing'; level=1; upgradeLevels={};
  potionCount=0; regenTimer=0;
  player=initPlayer(); effects=[];
  map=generateMap(); monsters=spawnMonsters();
  document.getElementById('attackBtn').style.display='block';
  document.getElementById('shopBtn').style.display='block';
  document.getElementById('dpad').style.display='block';
  requestAnimationFrame(loop);
}

function nextLevel(){
  level++;
  if(level>4){gameState='win';showOverlay('win');return;}
  map=generateMap();
  let saved={coins:player.coins,hp:player.hp,maxHp:player.maxHp,atk:player.atk,def:player.def,spd:player.spd};
  player={...initPlayer(),...saved,x:2*tileSize+tileSize/2,y:2*tileSize+tileSize/2};
  monsters=spawnMonsters(); effects=[];
}

function showOverlay(type){
  document.getElementById('attackBtn').style.display='none';
  document.getElementById('shopBtn').style.display='none';
  document.getElementById('dpad').style.display='none';
  let ov=document.getElementById('overlay'); ov.style.display='flex';
  if(type==='win') ov.innerHTML='<h1 class="win">⚔ Victory!</h1><p>You have cleansed the dungeon! The kingdom is saved!</p><p>Coins earned: '+player.coins+'</p><button onclick="startGame()">Play Again</button>';
  else ov.innerHTML='<h1 class="lose">☠ You Died</h1><p>The monsters were too powerful... Your quest ends here.</p><button onclick="startGame()">Try Again</button>';
}

function tileAt(x,y){let c=Math.floor(x/tileSize),r=Math.floor(y/tileSize);if(!map||r<0||r>=map.rows||c<0||c>=map.cols)return TILE.WALL;return map.grid[r][c];}
function isWalkable(x,y){return tileAt(x,y)!==TILE.WALL;}
function canMoveTo(x,y,hw,hh){return isWalkable(x-hw,y-hh)&&isWalkable(x+hw,y-hh)&&isWalkable(x-hw,y+hh)&&isWalkable(x+hw,y+hh);}

function update(){
  if(gameState!=='playing'||shopOpen) return;
  frameCount++;

  if(potionCount>0){regenTimer++;if(regenTimer>=REGEN_INTERVAL){regenTimer=0;let h=REGEN_AMOUNT*potionCount,b=player.hp;player.hp=Math.min(player.maxHp,player.hp+h);let a=player.hp-b;if(a>0)addEffect(player.x,player.y-30,'+'+a+' HP','#44ff88');}}

  let dx=0,dy=0;
  if(keys['ArrowLeft'])dx-=1;if(keys['ArrowRight'])dx+=1;if(keys['ArrowUp'])dy-=1;if(keys['ArrowDown'])dy+=1;
  if(dx!==0&&dy!==0){dx*=0.707;dy*=0.707;}
  if(dx!==0||dy!==0)player.facing=Math.atan2(dy,dx);
  let nx=player.x+dx*player.spd,ny=player.y+dy*player.spd;
  if(canMoveTo(nx,player.y,12,14))player.x=nx;if(canMoveTo(player.x,ny,12,14))player.y=ny;

  let pt=tileAt(player.x,player.y);
  if(pt===TILE.STAIR&&monsters.length===0)nextLevel();
  if(pt===TILE.SHOP){openShop();return;}

  if(attackCooldown>0)attackCooldown--;
  if(player.attackTimer>0){player.attackTimer--;player.isAttacking=true;}else player.isAttacking=false;
  if(keys[' ']&&attackCooldown===0) doAttack();

  if(player.hitFlash>0)player.hitFlash--;

  monsters.forEach(m=>{
    let dist=Math.hypot(m.x-player.x,m.y-player.y);
    m.moveTimer--;if(m.hitFlash>0)m.hitFlash--;if(m.atkCool>0)m.atkCool--;
    let mdx=0,mdy=0;
    if(dist<m.aggro){let a=Math.atan2(player.y-m.y,player.x-m.x);mdx=Math.cos(a);mdy=Math.sin(a);m.facing=a;m.wanderDx=mdx;m.wanderDy=mdy;}
    else{if(m.moveTimer<=0){let a=Math.random()*Math.PI*2;m.wanderDx=Math.cos(a);m.wanderDy=Math.sin(a);m.moveTimer=60+Math.random()*60;}mdx=m.wanderDx;mdy=m.wanderDy;m.facing=Math.atan2(mdy,mdx);}
    let mnx=m.x+mdx*m.spd*0.8,mny=m.y+mdy*m.spd*0.8;
    if(canMoveTo(mnx,m.y,10,12))m.x=mnx;else m.wanderDx*=-1;
    if(canMoveTo(m.x,mny,10,12))m.y=mny;else m.wanderDy*=-1;
    if(dist<36&&m.atkCool===0){m.atkCool=60;let dmg=Math.max(1,m.atk-player.def);player.hp-=dmg;player.hitFlash=10;addEffect(player.x,player.y-20,'-'+dmg,'#ff4444');if(player.hp<=0){gameState='dead';showOverlay('dead');}}
  });

  effects=effects.filter(e=>e.life>0);effects.forEach(e=>{e.y-=0.8;e.life--;e.alpha=e.life/e.maxLife;});
}

function addEffect(x,y,text,color){effects.push({x,y,text,color,life:60,maxLife:60,alpha:1});}

function doAttack(){
  if(gameState!=='playing'||shopOpen||attackCooldown>0)return;
  let pt=tileAt(player.x,player.y);
  attackCooldown=30;player.isAttacking=true;player.attackTimer=12;
  monsters.forEach(m=>{if(Math.hypot(m.x-player.x,m.y-player.y)<55){m.hp-=player.atk;m.hitFlash=8;addEffect(m.x,m.y,'-'+player.atk,'#ff6666');if(m.hp<=0){addEffect(m.x,m.y,'+'+m.reward,'#ffd700');player.coins+=m.reward;}}});
  monsters=monsters.filter(m=>m.hp>0);
  if(monsters.length===0&&pt!==TILE.STAIR)addEffect(player.x,player.y-40,'All cleared! Find stairs!','#ffd700');
}

function drawTile(r,c,type){
  let x=c*tileSize,y=r*tileSize;
  if(type===TILE.WALL){ctx.fillStyle='#0d0905';ctx.fillRect(x,y,tileSize,tileSize);ctx.fillStyle='#2a1e0e';ctx.fillRect(x,y,tileSize,tileSize-6);ctx.fillStyle='#1a1208';for(let i=0;i<tileSize;i+=8)ctx.fillRect(x+i,y+tileSize-8,7,7);ctx.fillStyle='#3a2810';ctx.fillRect(x,y,tileSize,3);}
  else if(type===TILE.FLOOR){ctx.fillStyle=(r+c)%2===0?'#1e1508':'#221a0a';ctx.fillRect(x,y,tileSize,tileSize);ctx.strokeStyle='#2a1e0e';ctx.lineWidth=0.5;ctx.strokeRect(x+.5,y+.5,tileSize-1,tileSize-1);}
  else if(type===TILE.STAIR){ctx.fillStyle='#1e1508';ctx.fillRect(x,y,tileSize,tileSize);ctx.fillStyle='#5a4020';for(let i=0;i<4;i++)ctx.fillRect(x+6+i*8,y+8+i*7,tileSize-12-i*8,6);ctx.fillStyle='#c8960a';ctx.font='11px Georgia';ctx.textAlign='center';ctx.fillText('▼',x+tileSize/2,y+tileSize-8);}
  else if(type===TILE.SHOP){ctx.fillStyle='#2a1800';ctx.fillRect(x,y,tileSize,tileSize);ctx.fillStyle='#7a4a10';ctx.fillRect(x+6,y+10,tileSize-12,tileSize-14);ctx.fillStyle='#c8960a';ctx.font='bold 10px Georgia';ctx.textAlign='center';ctx.fillText('$',x+tileSize/2,y+tileSize/2+4);}
}

function drawHealthBar(x,y,hp,maxHp,w){ctx.fillStyle='#111';ctx.fillRect(x-w/2,y,w,6);let pct=Math.max(0,hp/maxHp);ctx.fillStyle=pct>0.5?'#44cc44':pct>0.25?'#cccc00':'#cc2222';ctx.fillRect(x-w/2,y,w*pct,6);ctx.strokeStyle='#444';ctx.lineWidth=1;ctx.strokeRect(x-w/2,y,w,6);}

function drawKnight(x,y,facing,isAttacking,hitFlash,hp,maxHp){
  ctx.save();ctx.translate(x,y);
  if(hitFlash>0&&Math.floor(hitFlash/2)%2===0)ctx.globalAlpha=0.4;
  let bob=Math.sin(frameCount*0.15)*2;
  ctx.fillStyle='rgba(0,0,0,0.3)';ctx.beginPath();ctx.ellipse(0,16,14,6,0,0,Math.PI*2);ctx.fill();
  let flip=Math.cos(facing)<0?-1:1;ctx.scale(flip,1);
  ctx.fillStyle='#445577';ctx.fillRect(-8,6+bob,6,12);ctx.fillRect(2,6+bob,6,12);ctx.fillStyle='#334466';ctx.fillRect(-8,14+bob,6,5);ctx.fillRect(2,14+bob,6,5);
  ctx.fillStyle='#778899';ctx.fillRect(-9,-8+bob,18,16);ctx.fillStyle='#889ab0';ctx.fillRect(-7,-7+bob,14,8);ctx.fillStyle='#c8960a';ctx.fillRect(-9,-2+bob,18,3);
  ctx.fillStyle='#667788';ctx.fillRect(-13,-6+bob,6,10);
  if(isAttacking){ctx.save();ctx.translate(10,-6+bob);ctx.rotate(-0.8);ctx.fillStyle='#667788';ctx.fillRect(0,0,6,10);ctx.restore();}else ctx.fillRect(7,-6+bob,6,10);
  ctx.fillStyle='#c8960a';ctx.fillRect(-20,-8+bob,8,14);ctx.fillStyle='#884400';ctx.fillRect(-19,-7+bob,6,12);ctx.fillStyle='#ffd700';ctx.beginPath();ctx.arc(-16,-2+bob,3,0,Math.PI*2);ctx.fill();
  if(isAttacking){ctx.save();ctx.translate(10,-10+bob);ctx.rotate(-1.2);ctx.fillStyle='#aabbcc';ctx.fillRect(-2,-20,4,24);ctx.fillStyle='#c8960a';ctx.fillRect(-6,0,12,4);ctx.fillStyle='#8899aa';ctx.fillRect(-1,4,2,6);ctx.restore();}
  else{ctx.fillStyle='#aabbcc';ctx.fillRect(8,-20+bob,3,24);ctx.fillStyle='#c8960a';ctx.fillRect(4,-2+bob,10,3);}
  ctx.fillStyle='#889ab0';ctx.fillRect(-8,-24+bob,16,17);ctx.fillStyle='#667788';ctx.fillRect(-8,-24+bob,16,4);ctx.fillStyle='#ffd700';ctx.fillRect(-6,-20+bob,12,2);ctx.fillStyle='#222';ctx.fillRect(-5,-16+bob,10,4);ctx.fillStyle='#cc2222';ctx.fillRect(-2,-30+bob,4,8);
  if(potionCount>0){let pulse=0.25+0.15*Math.sin(frameCount*0.1);ctx.globalAlpha=pulse;ctx.fillStyle='#44ff88';ctx.beginPath();ctx.arc(0,0,20,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
  ctx.restore();
  drawHealthBar(x,y-44,hp,maxHp,36);
}

function drawMonster(m){
  ctx.save();ctx.translate(m.x,m.y);if(m.hitFlash>0&&Math.floor(m.hitFlash/2)%2===0)ctx.globalAlpha=0.3;
  let bob=Math.sin(frameCount*0.1+m.x)*2,flip=Math.cos(m.facing)<0?-1:1;
  ctx.fillStyle='rgba(0,0,0,0.25)';ctx.beginPath();ctx.ellipse(0,m.size/2-4,m.size*0.5,m.size*0.2,0,0,Math.PI*2);ctx.fill();
  if(m.shape==='slime'){ctx.fillStyle=m.color;ctx.beginPath();ctx.ellipse(0,4+bob,16,12,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#88ff88';ctx.beginPath();ctx.ellipse(-4,0+bob,5,4,-0.3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#003300';ctx.fillRect(-5,2+bob,4,3);ctx.fillRect(2,2+bob,4,3);}
  else if(m.shape==='skeleton'){ctx.scale(flip,1);ctx.fillStyle=m.color;ctx.fillRect(-5,-2+bob,10,14);ctx.fillStyle='#eeeecc';ctx.fillRect(-8,-16+bob,16,15);ctx.fillStyle='#111';ctx.fillRect(-5,-11+bob,4,4);ctx.fillRect(2,-11+bob,4,4);ctx.fillStyle=m.color;ctx.fillRect(-12,-6+bob,5,10);ctx.fillRect(8,-6+bob,5,10);ctx.fillRect(-5,12+bob,4,10);ctx.fillRect(1,12+bob,4,10);ctx.fillStyle='#cc4444';ctx.fillRect(-6,-6+bob,12,4);}
  else if(m.shape==='goblin'){ctx.scale(flip,1);ctx.fillStyle=m.color;ctx.fillRect(-6,-4+bob,12,14);ctx.fillRect(-6,10+bob,4,8);ctx.fillRect(2,10+bob,4,8);ctx.fillRect(-10,-2+bob,5,8);ctx.fillRect(6,-2+bob,5,8);ctx.fillStyle='#66aa22';ctx.fillRect(-7,-16+bob,14,13);ctx.fillStyle='#ffff44';ctx.fillRect(-4,-11+bob,3,4);ctx.fillRect(2,-11+bob,3,4);ctx.fillStyle='#224400';ctx.fillRect(-3,-6+bob,6,2);ctx.fillStyle='#884400';ctx.fillRect(-3,-18+bob,2,6);ctx.fillRect(1,-18+bob,2,6);}
  else if(m.shape==='orc'){ctx.scale(flip,1);ctx.fillStyle=m.color;ctx.fillRect(-11,-4+bob,22,18);ctx.fillRect(-8,14+bob,6,9);ctx.fillRect(2,14+bob,6,9);ctx.fillRect(-17,-2+bob,7,14);ctx.fillRect(10,-2+bob,7,14);ctx.fillStyle='#cc7722';ctx.fillRect(-10,-18+bob,20,16);ctx.fillStyle='#ff6600';ctx.fillRect(-6,-12+bob,4,5);ctx.fillRect(3,-12+bob,4,5);ctx.fillStyle='#ffccaa';ctx.fillRect(-4,-7+bob,8,3);ctx.fillStyle='#cccccc';ctx.fillRect(8,-14+bob,3,20);ctx.fillRect(-11,-14+bob,3,20);}
  else if(m.shape==='dragon'){ctx.scale(flip,1);ctx.fillStyle=m.color;ctx.fillRect(-14,-6+bob,28,20);ctx.fillRect(-8,14+bob,8,10);ctx.fillRect(0,14+bob,8,10);ctx.fillRect(-18,-8+bob,8,14);ctx.fillRect(10,-8+bob,8,14);ctx.fillStyle='#aa2222';ctx.fillRect(-12,-22+bob,24,18);ctx.fillStyle='#ffff00';ctx.fillRect(-8,-16+bob,5,6);ctx.fillRect(3,-16+bob,5,6);ctx.fillStyle='#ffa500';ctx.fillRect(-5,-8+bob,10,3);ctx.fillStyle='rgba(180,40,40,0.6)';ctx.beginPath();ctx.moveTo(-14,-8+bob);ctx.lineTo(-36,-28+bob);ctx.lineTo(-30,2+bob);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(14,-8+bob);ctx.lineTo(36,-28+bob);ctx.lineTo(30,2+bob);ctx.closePath();ctx.fill();ctx.fillStyle='#661111';ctx.fillRect(-8,-28+bob,3,8);ctx.fillRect(5,-28+bob,3,8);}
  ctx.restore();
  drawHealthBar(m.x,m.y-m.size-14,m.hp,m.maxHp,m.size*1.8);
  ctx.fillStyle='#ccc';ctx.font='9px Georgia';ctx.textAlign='center';ctx.fillText(m.name,m.x,m.y-m.size-17);
}

function drawHUD(){
  ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(10,10,200,potionCount>0?95:72);
  ctx.strokeStyle='#c8960a';ctx.lineWidth=1;ctx.strokeRect(10,10,200,potionCount>0?95:72);
  ctx.fillStyle='#ffd700';ctx.font='bold 14px Georgia';ctx.textAlign='left';
  ctx.fillText('⚔ Knight\'s Quest',20,28);
  ctx.fillText('Coins: '+player.coins,20,48);
  ctx.fillStyle='#aaa';ctx.font='11px Georgia';
  ctx.fillText('Level '+level+' | ATK:'+player.atk+' DEF:'+player.def,20,64);
  if(potionCount>0){
    let progress=regenTimer/REGEN_INTERVAL,secsLeft=Math.ceil((REGEN_INTERVAL-regenTimer)/60);
    ctx.fillStyle='#111';ctx.fillRect(20,70,180,6);ctx.fillStyle='#44ff88';ctx.fillRect(20,70,180*progress,6);
    ctx.strokeStyle='#44aa66';ctx.lineWidth=1;ctx.strokeRect(20,70,180,6);
    ctx.fillStyle='#44ff88';ctx.font='10px Georgia';ctx.fillText('🧪 ×'+potionCount+'  +'+(REGEN_AMOUNT*potionCount)+'HP in '+secsLeft+'s',20,90);
  }
  let bw=200,bh=18,bx=10,by=H-36;
  ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(bx-4,by-20,bw+80,40);
  ctx.fillStyle='#111';ctx.fillRect(bx,by,bw,bh);
  let pct=Math.max(0,player.hp/player.maxHp);
  ctx.fillStyle=pct>0.5?'#44cc44':pct>0.25?'#cccc00':'#cc2222';ctx.fillRect(bx,by,bw*pct,bh);
  ctx.strokeStyle='#c8960a';ctx.lineWidth=1.5;ctx.strokeRect(bx,by,bw,bh);
  ctx.fillStyle='#fff';ctx.font='bold 12px Georgia';ctx.textAlign='center';ctx.fillText(Math.max(0,player.hp)+' / '+player.maxHp,bx+bw/2,by+13);
  ctx.fillStyle='#c8960a';ctx.font='11px Georgia';ctx.textAlign='left';ctx.fillText('HP',bx+bw+8,by+13);
  ctx.fillStyle='#ff8888';ctx.font='12px Georgia';ctx.textAlign='right';ctx.fillText('Monsters: '+monsters.length,W-14,H-20);
  ctx.fillStyle='#555';ctx.font='11px Georgia';ctx.fillText('Arrows: Move | Space: Attack | S: Shop',W-14,H-6);
  if(monsters.length===0){ctx.fillStyle='#ffd700';ctx.font='bold 14px Georgia';ctx.textAlign='center';ctx.fillText('All monsters defeated! Find the stairs ▼ to advance!',W/2,32);}
}

function drawMinimap(){
  if(!map||!player)return;
  const s=3;
  const mw=map.cols*s, mh=map.rows*s;
  const mx=W-mw-12, my=12;
  ctx.fillStyle='rgba(0,0,0,0.75)';ctx.fillRect(mx-3,my-3,mw+6,mh+6);
  ctx.strokeStyle='#c8960a';ctx.lineWidth=1;ctx.strokeRect(mx-3,my-3,mw+6,mh+6);
  for(let r=0;r<map.rows;r++)for(let c=0;c<map.cols;c++){
    const t=map.grid[r][c];
    if(t===TILE.WALL)ctx.fillStyle='#0d0905';
    else if(t===TILE.FLOOR)ctx.fillStyle='#2a1e08';
    else if(t===TILE.STAIR)ctx.fillStyle='#ffd700';
    else if(t===TILE.SHOP)ctx.fillStyle='#c8960a';
    ctx.fillRect(mx+c*s,my+r*s,s,s);
  }
  monsters.forEach(m=>{
    ctx.fillStyle='#ff3333';
    ctx.fillRect(mx+Math.floor(m.x/tileSize)*s,my+Math.floor(m.y/tileSize)*s,s,s);
  });
  ctx.fillStyle='#ffffff';
  ctx.fillRect(mx+Math.floor(player.x/tileSize)*s,my+Math.floor(player.y/tileSize)*s,s,s);
  ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(mx-3,mh+my+4,66,13);
  ctx.font='9px Georgia';ctx.textAlign='left';
  ctx.fillStyle='#ff3333';ctx.fillText('■',mx-2,mh+my+13);ctx.fillStyle='#aaa';ctx.fillText(' monster',mx+5,mh+my+13);
  ctx.fillStyle='#ffd700';ctx.fillText('■',mx+44,mh+my+13);ctx.fillStyle='#aaa';ctx.fillText(' stair',mx+51,mh+my+13);
}

function draw(){
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#0d0905';ctx.fillRect(0,0,W,H);
  if(!map)return;
  for(let r=0;r<map.rows;r++)for(let c=0;c<map.cols;c++)drawTile(r,c,map.grid[r][c]);
  monsters.forEach(m=>drawMonster(m));
  if(player)drawKnight(player.x,player.y,player.facing,player.isAttacking,player.hitFlash,player.hp,player.maxHp);
  effects.forEach(e=>{ctx.save();ctx.globalAlpha=e.alpha;ctx.fillStyle=e.color;ctx.font='bold 14px Georgia';ctx.textAlign='center';ctx.fillText(e.text,e.x,e.y);ctx.restore();});
  if(player){drawHUD();drawMinimap();let ab=document.getElementById('attackBtn');if(ab&&ab.style.display!=='none')ab.disabled=attackCooldown>0;}
}

function loop(){update();draw();if(gameState==='playing'||gameState==='dead'||gameState==='win')requestAnimationFrame(loop);}

function toggleShop(){if(shopOpen)closeShop();else if(gameState==='playing')openShop();}
function openShop(){if(shopOpen)return;shopOpen=true;document.getElementById('shopPanel').style.display='block';document.getElementById('shopBtn').textContent='✖ Close Shop [S]';document.getElementById('gameCanvas').style.pointerEvents='none';renderShop();}
function closeShop(){shopOpen=false;document.getElementById('shopPanel').style.display='none';document.getElementById('shopBtn').textContent='🛒 Shop [S]';document.getElementById('gameCanvas').style.pointerEvents='auto';}
function renderShop(){
  let html='<div style="color:#ffd700;margin-bottom:12px;font-size:15px;">Your Coins: <strong>'+player.coins+'</strong></div>';
  UPGRADES.forEach(u=>{
    let lvl=upgradeLevels[u.id]||0,canBuy=player.coins>=u.cost&&lvl<u.maxLevel,maxed=lvl>=u.maxLevel&&u.maxLevel!==999;
    let extra=u.id==='potion'&&potionCount>0?' (owned: '+potionCount+')':'';
    html+='<div class="shop-item"><div><div class="shop-item-name">'+u.icon+' '+u.name+(u.maxLevel!==999?' ['+lvl+'/'+u.maxLevel+']':extra)+'</div><div class="shop-item-desc">'+u.desc+'</div></div>';
    html+='<button class="shop-btn"'+(canBuy?'':' disabled')+' onclick="buyUpgrade(\''+u.id+'\')">'+(maxed?'MAX':u.cost+' coins')+'</button></div>';
  });
  document.getElementById('shopItems').innerHTML=html;
}
function buyUpgrade(id){
  let u=UPGRADES.find(x=>x.id===id);if(!u||player.coins<u.cost)return;
  let lvl=upgradeLevels[u.id]||0;if(lvl>=u.maxLevel)return;
  player.coins-=u.cost;
  if(u.stat==='potion')potionCount++;
  else if(u.stat==='maxHp'){player.maxHp+=u.val;player.hp=Math.min(player.hp+u.val,player.maxHp);}
  else player[u.stat]+=u.val;
  if(u.maxLevel!==999)upgradeLevels[u.id]=(upgradeLevels[u.id]||0)+1;
  renderShop();
}

const DPAD_MAP = {btnUp:'ArrowUp', btnDown:'ArrowDown', btnLeft:'ArrowLeft', btnRight:'ArrowRight'};
Object.entries(DPAD_MAP).forEach(([id,key])=>{
  const btn=document.getElementById(id);
  btn.addEventListener('mousedown',  e=>{keys[key]=true;  e.preventDefault();});
  btn.addEventListener('mouseup',    ()=>keys[key]=false);
  btn.addEventListener('mouseleave', ()=>keys[key]=false);
  btn.addEventListener('touchstart', e=>{keys[key]=true;  e.preventDefault();},{passive:false});
  btn.addEventListener('touchend',   ()=>keys[key]=false);
  btn.addEventListener('touchcancel',()=>keys[key]=false);
});

document.addEventListener('keydown',e=>{
  keys[e.key]=true;
  if(e.key==='s'||e.key==='S'){if(shopOpen)closeShop();else if(gameState==='playing')openShop();}
  if(e.key===' ')e.preventDefault();
  if(e.key.startsWith('Arrow'))e.preventDefault();
});
document.addEventListener('keyup',e=>{keys[e.key]=false;});
canvas.addEventListener('touchstart',e=>{canvas._touch={x:e.touches[0].clientX,y:e.touches[0].clientY,time:Date.now()};},{passive:true});
canvas.addEventListener('touchend',e=>{let t=canvas._touch;if(!t)return;let dx=e.changedTouches[0].clientX-t.x,dy=e.changedTouches[0].clientY-t.y;if(Math.abs(dx)<10&&Math.abs(dy)<10&&Date.now()-t.time<300){keys[' ']=true;setTimeout(()=>{keys[' ']=false;},50);}},{passive:true});
