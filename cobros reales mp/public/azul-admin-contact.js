/* Datos de contacto y foto real del local, editables por la administradora. */
(()=>{
 'use strict';
 const previousSettings=renderSettings;
 renderSettings=function(){
  previousSettings();const form=$('#settingsForm'),contact=window.AzulContactInfo;
  if(!data.settings.whatsapp)form.elements.whatsapp.value=contact.whatsapp;
  if(!data.settings.email)form.elements.email.value=contact.email;
  if(!data.settings.address||/Aldo\s+Papa\s+708/i.test(data.settings.address))form.elements.address.value=contact.address;
  const card=document.createElement('div');card.className='settings-card';
  const photo=/^\/media\/[a-f0-9-]{36}$/.test(data.settings.storePhoto||'')?data.settings.storePhoto:'';
  card.innerHTML='<div class="eyebrow">TU LOCAL, CERCA DE TUS CLIENTAS</div><h2>Mostrá tu local.</h2><p class="store-photo-help">Cargá una foto real del frente o del interior. Se verá junto a tu dirección y al botón Cómo llegar.</p><label>Teléfono del local<input name="phone" type="tel" value="'+esc(data.settings.phone||contact.phone)+'" maxlength="25"><small class="field-note">Código de país y número, sin el 0 inicial. Ej.: 543442408895.</small></label><input type="hidden" name="storePhoto" id="storePhotoValue" value="'+esc(photo)+'"><div class="admin-store-photo" id="adminStorePhoto" '+(!photo?'hidden':'')+'><img id="adminStorePhotoImage" '+(photo?'src="'+esc(photo)+'"':'')+' alt="Foto del local"><button class="btn secondary" type="button" id="removeStorePhoto">Quitar foto</button></div><label class="store-photo-upload">Foto del local<input type="file" id="storePhotoInput" accept="image/jpeg,image/png,image/webp"><small class="field-note">JPG, PNG o WebP · hasta 5 MB. Después de elegirla, guardá los cambios.</small></label><p class="field-note" id="storePhotoUploadStatus" role="status" aria-live="polite"></p>';
  form.insertBefore(card,form.lastElementChild);
  $('#storePhotoInput').addEventListener('change',async event=>{
   const file=event.target.files?.[0];if(!file)return;
   $('#saveSettingsBtn').disabled=true;event.target.disabled=true;$('#storePhotoUploadStatus').textContent='Preparando y subiendo la foto…';
   try{const blob=await compress(file),result=await api('upload',{method:'POST',headers:{'Content-Type':blob.type},body:blob});if(!/^\/media\/[a-f0-9-]{36}$/.test(result.url||''))throw new Error('No pudimos guardar la foto. Intentá de nuevo.');$('#storePhotoValue').value=result.url;$('#adminStorePhotoImage').src=result.url;$('#adminStorePhoto').hidden=false;$('#storePhotoUploadStatus').textContent='✓ Foto lista. Tocá Guardar cambios para publicarla en tu tienda.';}
   catch(error){$('#storePhotoUploadStatus').textContent=error.message;}
   finally{$('#saveSettingsBtn').disabled=false;event.target.disabled=false;event.target.value='';}
  });
  $('#removeStorePhoto').addEventListener('click',()=>{$('#storePhotoValue').value='';$('#adminStorePhoto').hidden=true;$('#adminStorePhotoImage').removeAttribute('src');$('#storePhotoUploadStatus').textContent='Guardá los cambios para quitar la foto de tu tienda.';});
 };
 if(view==='settings')renderSettings();
})();
