(()=>{
 'use strict';
 const fallback=window.AzulContactInfo;
 const instagramIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></svg>';
 function contact(){
  const clean=value=>String(value||'').replace(/\D/g,'');
  const whatsapp=/^\d{10,15}$/.test(clean(settings.whatsapp))?clean(settings.whatsapp):fallback.whatsapp;
  const phone=/^\d{8,15}$/.test(clean(settings.phone))?clean(settings.phone):fallback.phone;
  const instagram=/^[\w.]{1,30}$/.test(settings.instagram||'')?settings.instagram:fallback.instagram;
  const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email||'')?settings.email:fallback.email;
  const address=settings.address&&!/Aldo\s+Papa\s+708/i.test(settings.address)?settings.address:fallback.address;
  return {whatsapp,phone,instagram,email,address};
 }
 function updateContact(){
  const c=contact(),ig='https://www.instagram.com/'+encodeURIComponent(c.instagram)+'/',wa='https://wa.me/'+c.whatsapp+'?text='+encodeURIComponent('Hola, AZUL bendito. Quiero hacer una consulta.');
  if(!settings.announcement||/^Una nueva forma de sentirte vos/.test(settings.announcement))$('.announcement').textContent='ENVÍOS A TODO EL PAÍS · MODA EN TALLES GRANDES';
  $$('.azul-instagram-link').forEach(a=>a.href=ig);$('#instagramHandle').textContent='@'+c.instagram;$('#contactInstagramText').textContent='@'+c.instagram;
  $$('.azul-whatsapp-link').forEach(a=>a.href=wa);$('#contactWhatsAppText').textContent=c.whatsapp===fallback.whatsapp?'+54 3442 408895':'+'+c.whatsapp;
  $('#contactPhone').href='tel:+'+c.phone;$('#contactPhoneText').textContent=c.phone===fallback.phone?'03442 408895':'+'+c.phone;
  $('#contactEmail').href='mailto:'+c.email;$('#contactEmailText').textContent=c.email;
  $('#contactAddress').textContent=c.address;$('#storeAddress').textContent=c.address;
  const destination=c.address+', '+fallback.region;
  $$('.azul-directions-link').forEach(a=>a.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(destination));
  const photo=/^\/media\/[a-f0-9-]{36}$/.test(settings.storePhoto||'')?settings.storePhoto:'';
  $('#storePhoto').hidden=!photo;$('#storePhotoPlaceholder').hidden=!!photo;if(photo)$('#storePhoto').src=photo;else $('#storePhoto').removeAttribute('src');
  $('#contactBtn').onclick=()=>window.open(wa,'_blank','noopener');
  $('#shopSocials').innerHTML='<a class="footer-instagram azul-instagram-link" href="'+ig+'" target="_blank" rel="noopener">'+instagramIcon+'<span>Seguinos en Instagram <strong>@'+esc(c.instagram)+'</strong></span><span>↗</span></a><a class="footer-email" href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>';
 }
 const previousBrand=brand;brand=function(){previousBrand();updateContact();};
 updateContact();
 const form=$('#contactForm');
 form.addEventListener('submit',event=>{
  if(form.dataset.preview==='true'){event.preventDefault();$('#contactFormStatus').textContent='Esta es una vista de diseño: tu consulta no se envió. El formulario se activa en la tienda publicada.';return;}
  $('#contactSubmit').disabled=true;$('#contactSubmit').textContent='Enviando consulta…';
 });
 window.addEventListener('pageshow',()=>{$('#contactSubmit').disabled=false;$('#contactSubmit').innerHTML='Enviar consulta <span>↗</span>';});
})();
