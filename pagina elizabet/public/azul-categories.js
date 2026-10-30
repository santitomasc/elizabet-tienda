/* Secciones compartidas por el catálogo y el panel. */
(()=>{
 'use strict';
 const items=Object.freeze(['Short/polleras','Short de jean','Remeras','Jeans','Verano','Blusas/camisas','Tops','Abrigo','Pantalones','Accesorios','Bodys','Vestidos','Zapatos 40-43']);
 const key=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const aliases={shorts:'Short/polleras',polleras:'Short/polleras',shortpolleras:'Short/polleras',shortspolleras:'Short/polleras',shortdejean:'Short de jean',shortsdejean:'Short de jean',camisas:'Blusas/camisas',blusas:'Blusas/camisas',blusascamisas:'Blusas/camisas',abrigos:'Abrigo',acc:'Accesorios',body:'Bodys',bodies:'Bodys',zapatos4043:'Zapatos 40-43'};
 function canonical(value){return items.find(name=>key(name)===key(value))||aliases[key(value)]||String(value||'').trim();}
 function categoryFor(product){
  // Solo se agrupa el jean ilustrativo antiguo; los productos reales respetan la sección elegida.
  if(product.sample&&product.id==='jean-clasico'&&key(product.category)==='pantalones')return 'Jeans';
  return canonical(product.category);
 }
 window.AzulSections=Object.freeze({items,key,canonical,categoryFor});
})();
