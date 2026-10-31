/* Franja de anuncios: recorrido continuo hacia la derecha. */
(()=>{
 'use strict';
 const bar=document.querySelector('.announcement');
 if(!bar)return;
 let paused=false;
 const observer=new MutationObserver(render);
 function watch(){observer.observe(bar,{childList:true,subtree:true,characterData:true});}
 function render(){
  const existing=bar.querySelector('.announcement-readable');
  if(existing&&bar.querySelector('.announcement-track'))return;
  const text=bar.textContent.trim();
  if(!text)return;
  observer.disconnect();
  const readable=document.createElement('span');readable.className='sr-only announcement-readable';readable.textContent=text;
  const track=document.createElement('span');track.className='announcement-track';track.setAttribute('aria-hidden','true');
  for(let group=0;group<2;group++){
   const row=document.createElement('span');row.className='announcement-group';
   for(let repeat=0;repeat<4;repeat++){
    const item=document.createElement('span');item.className='announcement-item';item.textContent=text;
    const separator=document.createElement('span');separator.className='announcement-separator';separator.textContent='✦';
    row.append(item,separator);
   }
   track.append(row);
  }
  const pause=document.createElement('button');pause.type='button';pause.className='announcement-pause';pause.setAttribute('aria-pressed',String(paused));pause.setAttribute('aria-label',paused?'Reanudar anuncios':'Pausar anuncios');pause.textContent=paused?'▶':'Ⅱ';
  pause.addEventListener('click',()=>{paused=!paused;bar.classList.toggle('announcement-paused',paused);pause.setAttribute('aria-pressed',String(paused));pause.setAttribute('aria-label',paused?'Reanudar anuncios':'Pausar anuncios');pause.textContent=paused?'▶':'Ⅱ';});
  bar.replaceChildren(readable,track,pause);bar.classList.add('announcement-loop');bar.classList.toggle('announcement-paused',paused);watch();
 }
 render();
})();
