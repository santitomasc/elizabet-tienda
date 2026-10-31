/* Capa visual AZUL bendito. Mantiene la implementación existente de la tienda. */
(()=>{
 'use strict';
 const oldBrand=brand;
 const oldAbout='Creemos en las prendas que elegís una y otra vez. En los detalles simples, las texturas lindas y la libertad de combinar a tu manera.';
 const oldAnnouncements=['Una nueva forma de sentirte vos · Nueva colección','Una nueva forma de sentirte vos · Descubrí nuestra colección'];
 brand=function(){
  oldBrand();
  const legacy=/^ELIZABET$/i.test(String(settings.brand||'').trim());
  const name=legacy||!settings.brand?'AZUL bendito':settings.brand;
  document.title=name+' · Moda en talles grandes';
  if(legacy||/^azul\s*bendito$/i.test(name)){
   $$('.logo').forEach(el=>{el.classList.add('brand-logo');el.setAttribute('aria-label',name+' · Inicio');el.innerHTML='<img src="/assets/azul-logo.webp" alt="AZUL bendito" width="232" height="65">';});
  }else{$$('.logo').forEach(el=>el.classList.remove('brand-logo'));}
  if(!settings.announcement||oldAnnouncements.includes(settings.announcement))$('.announcement').textContent='MODA EN TALLES GRANDES · TODOS LOS ESTILOS, TU FORMA DE SER';
  if(!settings.about||settings.about===oldAbout)$('#aboutText').textContent='AZUL bendito es moda en talles grandes para mujeres reales. Nos inspiran el mar, su calma y esa sensación de libertad que queremos llevar a cada look.';
  $('#storyNameText').textContent='Remeras, jeans, vestidos, buzos y mucho más. Distintos estilos para acompañarte en tu día a día, con comodidad y personalidad.';
  $('#copyright').textContent='© '+new Date().getFullYear()+' '+name;
  $('.vertical-text').textContent=name.toUpperCase()+' · INSPIRADAS EN EL MAR';
  $('.story-visual>span').innerHTML='Tu estilo, sin límites.<small>AZUL BENDITO · MUJERES REALES</small>';
  $('.photo-caption small').textContent='La libertad de vestirte a tu manera.';
  if(!settings.instagram&&!$('#azulInstagram'))$('#shopSocials').insertAdjacentHTML('beforeend','<a id="azulInstagram" href="https://www.instagram.com/azulbendito.tallesgrandes/" target="_blank" rel="noopener">Instagram · @azulbendito.tallesgrandes ↗</a>');
 };
 if(settings.brand)brand();
 const sections=window.AzulSections;
 const previousProducts=renderProducts;
 const garment='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m11 6-7 4 3 7 4-2v12h10V15l4 2 3-7-7-4c-1 4-9 4-10 0Z"/></svg>';
 const covers={
  'Short/polleras':'<path d="M8 7h16l2 20H17l-1-9-1 9H6L8 7Zm0 5h16"/>',
  'Short de jean':'<path d="M8 7h16l2 20H17l-1-9-1 9H6L8 7Zm0 5h16M16 7v6M8 13l4 3M24 13l-4 3"/>',
  'Jeans':'<path d="M9 4h14l2 25h-8l-1-14-1 14H7L9 4Zm0 5h14M16 4v6M9 10l4 3M23 10l-4 3"/>',
  'Pantalones':'<path d="M9 4h14l2 25h-8l-1-14-1 14H7L9 4Zm0 5h14M16 4v6"/>',
  'Vestidos':'<path d="M12 4h8l2 7-3 4 7 14H6l7-14-3-4 2-7ZM13 15h6"/>',
  'Bodys':'<path d="M11 4h10l3 9-4 10-2 6h-4l-2-6-4-10 3-9Zm1 19h8"/>',
  'Tops':'<path d="M11 6v7m10-7v7M11 8h10l3 17H8L11 8Z"/>',
  'Zapatos 40-43':'<path d="M8 5h10v13l8 5v5H5v-8l3-5V5Zm-3 19h21M11 10h5M11 13h5"/>',
  'Accesorios':'<circle cx="16" cy="16" r="6"/><path d="M11 5h10v5H11zM11 22h10v5H11zM16 13v4l3 1"/>',
  'Verano':'<circle cx="16" cy="16" r="6"/><path d="M16 2v4M16 26v4M2 16h4M26 16h4M6 6l3 3M23 23l3 3M6 26l3-3M23 9l3-3"/>'
 };
 function icon(name){return covers[name]?'<svg viewBox="0 0 32 32" aria-hidden="true">'+covers[name]+'</svg>':garment;}
 renderFilters=function(){
  const rail=$('#filters'),scroll=rail.scrollLeft,focused=rail.contains(document.activeElement)?document.activeElement?.closest('[data-filter]')?.dataset.filter:null;
  const extra=[...new Set(products.map(p=>sections.categoryFor(p)))].filter(c=>c&&!sections.items.includes(c));
  rail.innerHTML=[...sections.items,...extra].map(name=>{
   const item=products.find(p=>sections.categoryFor(p)===name),selected=filter===name;
   return '<button class="section-link'+(selected?' selected':'')+'" type="button" data-filter="'+esc(name)+'" aria-pressed="'+selected+'"><span class="section-thumb">'+(item?'<img src="'+esc(item.photos[0])+'" alt="" loading="lazy">':icon(name))+'</span><span class="section-label">'+esc(name)+'</span></button>';
  }).join('');
  rail.scrollLeft=scroll;
  if(focused)Array.from(rail.querySelectorAll('[data-filter]')).find(b=>b.dataset.filter===focused)?.focus({preventScroll:true});
  $$('.catalog-tabs [data-filter]').forEach(b=>{const active=b.dataset.filter===filter;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
  $('#activeSectionLabel').textContent=filter==='Todas'?'Toda la colección':filter;
 };
 renderProducts=function(){
  const source=products;products=source.map(p=>({...p,category:sections.categoryFor(p)}));
  try{previousProducts();if(sections.items.includes(filter)&&!products.some(p=>p.category===filter)&&!search)$('#products').innerHTML='<div class="empty-results"><h3>Muy pronto, más '+esc(filter.toLowerCase())+'.</h3><p>Mientras tanto, encontrá tus favoritos en las otras secciones.</p><button class="underlined" id="resetFilters">Ver toda la colección ↗</button></div>';}
  finally{products=source;}
 };
 document.addEventListener('click',e=>{const button=e.target.closest('[data-sections-scroll]');if(button)$('#filters').scrollBy({left:Number(button.dataset.sectionsScroll)*Math.max(200,$('#filters').clientWidth*.72),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
 if(products.length)renderProducts();
 const slides=[
  {heading:'Tu estilo.<br>Tu libertad.<br><em>Tu azul.</em>',description:'Prendas para sentirte cómoda, linda y vos.<br>Todos los estilos. Sin dejar de ser quien sos.',image:'/assets/azul-modelo-frente.webp',alt:'Modelo de AZUL bendito con remera blanca de manga larga y pantalón negro',position:'50% 15%',caption:'AZUL BENDITO · NUESTRA ESENCIA',label:'UN MAR DE POSIBILIDADES',link:'Descubrí la colección'},
  {heading:'Tu talle.<br>Tu estilo.<br><em>Muy vos.</em>',description:'Moda en talles grandes para mujeres reales.<br>Te acompañamos a encontrar tu próximo look.',image:'/assets/azul-modelo-espalda.webp',alt:'Modelo de AZUL bendito mostrando el calce de una remera blanca y un short negro',position:'50% 12%',caption:'COMODIDAD, ESTILO Y LIBERTAD',label:'AZUL BENDITO · TALLES GRANDES',link:'Elegí tu próxima prenda'},
  {heading:'Un mar de<br><em>estilos.</em>',description:'Remeras, jeans, vestidos, buzos y más.<br>Elegí lo que te gusta. Vestite a tu manera.',image:'/assets/azul-mar.webp',alt:'Agua turquesa y olas suaves sobre una playa de arena clara',position:'53% 50%',caption:'TODOS LOS ESTILOS · MUY VOS',label:'INSPIRADAS EN EL MAR',link:'Encontrá tu próximo favorito'}
 ];
 const hero=$('.hero'),dots=$$('[data-sea-slide]'),reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 let index=0,timer=null,paused=false,hovered=false,focused=false,startX=null;
 function show(next,manual=false){
  index=(next+slides.length)%slides.length;const s=slides[index];
  $('#seaHeading').innerHTML=s.heading;$('#seaDescription').innerHTML=s.description;
  $('#seaPhoto').src=s.image;$('#seaPhoto').alt=s.alt;$('#seaPhoto').style.objectPosition=s.position;
  $('#seaCaption').textContent=s.caption;$('.sea-label').textContent=s.label;
  $('#seaLink').innerHTML=s.link+' <span>↗</span>';
  dots.forEach((d,i)=>d.setAttribute('aria-pressed',String(i===index)));
  if(manual)$('#seaStatus').textContent='Portada '+(index+1)+' de '+slides.length;
  schedule();
 }
 function schedule(){clearTimeout(timer);if(!paused&&!hovered&&!focused&&!document.hidden&&!reduced.matches)timer=setTimeout(()=>show(index+1),8000);}
 dots.forEach(d=>d.addEventListener('click',()=>show(Number(d.dataset.seaSlide),true)));
 $('#seaNext').addEventListener('click',()=>show(index+1,true));$('#seaPrevious').addEventListener('click',()=>show(index-1,true));
 $('#seaPause').addEventListener('click',()=>{paused=!paused;$('#seaPause').setAttribute('aria-pressed',String(paused));$('#seaPause').setAttribute('aria-label',paused?'Reanudar carrusel':'Pausar carrusel');$('#seaPause').textContent=paused?'Reanudar':'Pausar';schedule();});
 hero.addEventListener('mouseenter',()=>{hovered=true;schedule();});hero.addEventListener('mouseleave',()=>{hovered=false;schedule();});
 hero.addEventListener('focusin',()=>{focused=true;schedule();});hero.addEventListener('focusout',e=>{focused=hero.contains(e.relatedTarget);schedule();});
 hero.addEventListener('touchstart',e=>{startX=e.changedTouches[0]?.clientX??null;},{passive:true});hero.addEventListener('touchend',e=>{const end=e.changedTouches[0]?.clientX;if(startX!==null&&end!==undefined&&Math.abs(end-startX)>65)show(index+(end<startX?1:-1),true);startX=null;},{passive:true});
 document.addEventListener('visibilitychange',schedule);reduced.addEventListener?.('change',schedule);schedule();
})();
