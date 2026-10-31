(function(){
 let loading=false;
 async function refresh(){
  if(view!=='settings'||loading)return;const form=document.getElementById('settingsForm');if(!form||form.querySelector('#paymentsState'))return;
  const section=document.createElement('section');section.className='settings-card';section.innerHTML='<div class="eyebrow">COBROS ONLINE</div><h2>Mercado Pago · Orders</h2><p id="paymentsState" role="status">Consultando la conexión…</p><p>Las credenciales de cobro se guardan en Netlify. No se ingresan en este panel.</p>';form.prepend(section);loading=true;
  try{const r=await fetch('/api/checkout/admin/status'),b=await r.json();if(!r.ok)throw new Error(b.error||'No pudimos verificar la conexión.');const message=!b.production?'Esta vista no puede generar cobros reales.':b.error?b.error:!b.configured?'Falta completar la configuración en Netlify.':b.enabled?'Cobros reales habilitados · cuenta '+b.merchant:'Cuenta conectada · cobros reales todavía desactivados.';section.querySelector('#paymentsState').textContent=message;}catch(e){section.querySelector('#paymentsState').textContent=e.message;}finally{loading=false;}
 }
 new MutationObserver(refresh).observe(document.getElementById('settingsForm'),{childList:true});document.addEventListener('click',()=>setTimeout(refresh,50));
})();
