(() => {
'use strict';
const G=window.GridDeck, $=s=>document.querySelector(s);
let deck, rev, si=0, selected=null, group=0, dirty=false, history=[], animations=[], raf=0, time=0, duration=1000, busy=false;
const clone=x=>JSON.parse(JSON.stringify(x));
const slide=()=>deck.slides[si];
const step=()=>slide().build.find(b=>b.id===selected);
const element=()=>slide().elements.find(e=>e.id===selected);
const label=e=>e.name||String(e.text||e.type).replace(/<[^>]*>/g,'').slice(0,24);
const supported=Object.keys(G.EFFECTS).filter(k=>!G.EFFECTS[k].special&&!G.EFFECTS[k].sceneOnly);
function node(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
function notify(text){$('#message').textContent=text;$('#message').style.display='block';clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#message').style.display='none',4200);}
function status(){ $('#status').textContent=busy?'儲存中…':dirty?'有未儲存修改':'已儲存'; $('#undo').disabled=!history.length||busy; $('#save').disabled=busy||!dirty; }
function remember(){history.push(clone(deck));if(history.length>40)history.shift();}
function changed(){dirty=true;status();}
function stop(){cancelAnimationFrame(raf);raf=0;$('#play').textContent='播放這一步';}
function fit(){const w=$('#canvas-wrap'),c=$('#canvas');const s=Math.max(.02,Math.min((w.clientWidth-48)/1920,(w.clientHeight-40)/1080));c.style.transform=`scale(${s})`;c.style.left=(w.clientWidth-1920*s)/2+'px';c.style.top=(w.clientHeight-1080*s)/2+'px';}
function seek(t){time=Math.max(0,Math.min(duration,t));for(const a of animations)a.anim.currentTime=Math.max(0,time-a.start);$('#seek').value=time;$('#clock').textContent=(time/1000).toFixed(2)+' s';}
function renderCanvas(){
 stop();animations.forEach(a=>a.anim.cancel());animations=[];
 const c=$('#canvas');c.replaceChildren(G.renderSlide(deck,slide(),{assetBase:'/deck/'}));
 const groups=G.buildGroups(slide());
 groups.forEach((steps,gi)=>steps.forEach(b=>{
  const target=c.querySelector('[data-id="'+CSS.escape(b.id)+'"] .gd-inner');
  if(!target||!supported.includes(b.effect))return;
  const fx=G.EFFECTS[b.effect];
  const a=target.animate(fx.kf,{duration:Math.max(1,b.dur),easing:b.easing||fx.easing||'cubic-bezier(.2,.75,.25,1)',fill:'both'});a.pause();
  if(gi<group)a.currentTime=Math.max(1,b.dur);else if(gi>group)a.currentTime=0;else{a.currentTime=0;animations.push({anim:a,start:b.start});}
 }));
 c.querySelectorAll('.gd-el').forEach(n=>{n.classList.toggle('chosen',n.dataset.id===selected);n.onclick=e=>{e.stopPropagation();select(n.dataset.id);};});
 fit();seek(duration);
}
function select(id){selected=id;const gi=G.buildGroups(slide()).findIndex(g=>g.some(b=>b.id===id));if(gi>=0&&gi!==group){group=gi;renderTimeline();renderCanvas();}renderElements();renderSettings();$('#canvas').querySelectorAll('.gd-el').forEach(n=>n.classList.toggle('chosen',n.dataset.id===id));$('#tracks').querySelectorAll('.bar').forEach(n=>n.classList.toggle('active',n.dataset.id===id));}
function renderElements(){const box=$('#elements');box.replaceChildren();slide().elements.forEach(e=>{const b=node('button',null,e.id===selected?'active':'');b.append(node('small',slide().build.some(s=>s.id===e.id)?'動畫':'靜態'),node('span',label(e)));b.onclick=()=>select(e.id);box.append(b);});}
function renderSettings(){const el=element(),b=step();$('#selected').textContent=el?label(el):'選取一個元素';$('#detail').textContent=b?'調整後可立即預覽；儲存後套用至簡報。':el?'這個元素目前直接顯示。':'從左側清單選取元素。';$('#settings').hidden=!b;$('#add').hidden=!el||!!b||el.hidden;if(!b)return;
 const fx=$('#effect');fx.replaceChildren();supported.forEach(k=>{const o=node('option',G.EFFECTS[k].label);o.value=k;fx.append(o);});if(!supported.includes(b.effect)){const o=node('option',(G.EFFECTS[b.effect]?.label||b.effect)+'（整頁預覽）');o.value=b.effect;fx.append(o);$('#detail').textContent='此效果請用「整頁播放」檢視；時間軸僅預覽一般入場效果。';}
 fx.value=b.effect;$('#trigger').value=b.trigger;$('#delay').value=(b.delay||0)/1000;$('#duration').value=(b.duration??600)/1000;
 const ease=$('#easing');ease.querySelector('[data-custom]')?.remove();const value=b.easing||G.EFFECTS[b.effect]?.easing||'cubic-bezier(.2,.75,.25,1)';if(!Array.from(ease.options).some(o=>o.value===value)){const o=node('option','原有速度曲線');o.value=value;o.dataset.custom='1';ease.append(o);}ease.value=value;
 $('#earlier').disabled=slide().build.indexOf(b)===0;$('#later').disabled=slide().build.indexOf(b)===slide().build.length-1;
}
function renderTimeline(){const groups=G.buildGroups(slide());group=Math.min(group,groups.length-1);const list=groups[group];duration=Math.max(1000,...list.map(b=>b.start+b.dur));$('#seek').max=duration;$('#end').textContent=(duration/1000).toFixed(2)+' s';$('#group-label').textContent=group?'點擊 '+group:'進入頁面 · 自動播放';const tabs=$('#groups');tabs.replaceChildren();groups.forEach((g,i)=>{const b=node('button',i?'點擊 '+i:'進入頁面',i===group?'active':'');b.setAttribute('aria-pressed',String(i===group));b.onclick=()=>{group=i;renderTimeline();renderCanvas();};tabs.append(b);});
 const tracks=$('#tracks');tracks.replaceChildren();if(!list.length)tracks.append(node('p','這一步沒有動畫。選取元素，將觸發方式設為「上一個結束後」可加入進頁動畫。','hint'));
 list.forEach(b=>{const el=slide().elements.find(e=>e.id===b.id);const row=node('div',null,'track'),lane=node('div',null,'lane');row.append(node('span',label(el),'track-name'),lane);const bar=node('button',G.EFFECTS[b.effect]?.label||b.effect,'bar'+(selected===b.id?' active':''));bar.dataset.id=b.id;bar.style.left=b.start/duration*100+'%';bar.style.width=b.dur/duration*100+'%';bar.title=`${label(el)} · ${(b.start/1000).toFixed(2)}s 開始，${b.dur/1000}s 時長`;bar.onclick=()=>select(b.id);lane.append(bar);tracks.append(row);
 bar.onpointerdown=e=>{if(e.button!==0)return;stop();const startX=e.clientX,original=slide().build.find(x=>x.id===b.id),old=original.delay||0,width=lane.clientWidth,range=duration;let moved=false;bar.setPointerCapture(e.pointerId);bar.onpointermove=ev=>{if(!moved&&Math.abs(ev.clientX-startX)<4)return;if(!moved){remember();moved=true;}original.delay=Math.max(0,Math.min(60000,Math.round((old+(ev.clientX-startX)/width*range)/50)*50));bar.style.left=Math.max(0,(b.start+original.delay-old)/range)*100+'%';};const finish=()=>{bar.onpointermove=null;bar.onpointerup=null;bar.onpointercancel=null;if(moved){selected=b.id;changed();render();}};bar.onpointerup=finish;bar.onpointercancel=finish;};
 });
}
function render(){slide().build=slide().build||[];$('#title').textContent=deck.meta.title;renderElements();renderSettings();renderTimeline();renderCanvas();status();}
function mutate(fn){remember();fn();changed();render();}
async function load(){const res=await fetch('/api/deck');if(!res.ok)throw Error('無法讀取簡報');const data=await res.json();deck=G.normalizeDeck(data.deck);rev=data.rev;if(!deck.slides.length)throw Error('簡報沒有頁面');si=Math.min(si,deck.slides.length-1);selected=null;group=0;history=[];dirty=false;const sel=$('#slides');sel.replaceChildren();deck.slides.forEach((s,i)=>{const o=node('option',`${i+1} · ${s.name||'頁面 '+(i+1)}`);o.value=i;sel.append(o);});sel.value=si;render();}
$('#slides').onchange=e=>{si=+e.target.value;group=0;selected=null;render();};
for(const key of ['effect','trigger','delay','duration','easing'])$('#'+key).onchange=e=>{const b=step();if(!b)return;let value=e.target.value;if(key==='delay'||key==='duration'){value=Number(value)*1000;if(!Number.isFinite(value)||value<(key==='delay'?0:50)||value>60000){notify('請輸入有效時間（最多 60 秒）。');renderSettings();return;}}mutate(()=>{b[key]=value;});};
$('#add').onclick=()=>mutate(()=>slide().build.push({id:selected,effect:'fade',trigger:'click',delay:0,duration:600}));
$('#remove').onclick=()=>mutate(()=>{slide().build=slide().build.filter(b=>b.id!==selected);});
for(const [id,d] of [['earlier',-1],['later',1]])$('#'+id).onclick=()=>{const i=slide().build.indexOf(step()),j=i+d;if(j<0||j>=slide().build.length)return;mutate(()=>{[slide().build[i],slide().build[j]]=[slide().build[j],slide().build[i]];});};
$('#undo').onclick=()=>{if(!history.length)return;deck=history.pop();changed();render();};
$('#seek').oninput=e=>{stop();seek(+e.target.value);};$('#reset').onclick=()=>{stop();seek(0);};
$('#play').onclick=()=>{if(raf){stop();return;}if(time>=duration)seek(0);const start=performance.now()-time;$('#play').textContent='暫停';const tick=now=>{seek(now-start);if(time<duration)raf=requestAnimationFrame(tick);else stop();};raf=requestAnimationFrame(tick);};
$('#reload').onclick=()=>{if(!dirty||confirm('重新讀取會捨棄工作台內尚未儲存的修改，繼續？'))load().catch(e=>notify(e.message));};
$('#save').onclick=async()=>{if(busy)return;busy=true;status();const sent=JSON.stringify(deck);try{const res=await fetch('/api/deck',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRev:rev,deck:JSON.parse(sent)})});const data=await res.json();if(!res.ok)throw Error(res.status===409?'原簡報已被其他視窗修改。請先保留需要的設定，再重新讀取；本次未覆蓋原檔。':data.error||'儲存失敗');rev=data.rev;if(JSON.stringify(deck)===sent)dirty=false;notify('動畫已儲存，可回靜態編輯器確認與匯出。');}catch(e){notify(e.message);}finally{busy=false;status();}};
$('#full').onclick=()=>{stop();const d=clone(deck);d.slides=[clone(slide())];delete d.slides[0].skip;const host=node('div',null,'player-host');document.body.append(host);let player;const close=()=>{player.destroy();host.remove();};player=new G.Player(host,d,{assetBase:'/deck/',onExit:close});const btn=node('button','關閉預覽（Esc）','player-close');btn.onclick=e=>{e.stopPropagation();close();};host.append(btn);player.start(0);requestAnimationFrame(()=>player.layout());};
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});new ResizeObserver(fit).observe($('#canvas-wrap'));
load().catch(e=>{$('#status').textContent='載入失敗';notify(e.message);});
})();
