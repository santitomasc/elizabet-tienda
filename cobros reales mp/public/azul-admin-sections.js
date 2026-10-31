/* Selección de sección en el panel existente; usa las mismas altas y guardados. */
(()=>{
 'use strict';
 const sections=window.AzulSections;
 function names(){return [...sections.items,...new Set(data.products.map(p=>sections.categoryFor(p)).filter(c=>c&&!sections.items.includes(c)))];}
 function populate(select,current,placeholder){
  const list=names();if(current&&!list.includes(current))list.push(current);
  select.innerHTML='<option value="">'+esc(placeholder)+'</option>'+list.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');select.value=current||'';
 }
 function brandPanel(){
  const brandName=/^ELIZABET$/i.test(String(data.settings.brand||'').trim())?'AZUL bendito':data.settings.brand||'AZUL bendito';
  $('#adminBrand').textContent=brandName;document.title='Mi tienda · '+brandName;
 }
 const previousProducts=renderProducts;
 renderProducts=function(){
  const source=data.products,selected=$('#categoryFilter').value;
  populate($('#categoryFilter'),selected,'Todas las secciones');
  data.products=source.filter(p=>!selected||sections.categoryFor(p)===selected).map(p=>({...p,category:sections.categoryFor(p)}));
  try{previousProducts();if(selected&&!data.products.length)$('#adminProducts').innerHTML='<div class="empty-list"><h3>Todavía no hay prendas en '+esc(selected)+'.</h3><p>Agregá un producto y elegí esta sección para que aparezca acá y en tu tienda.</p><button class="btn primary" id="emptyNewProduct">+ Agregar producto</button></div>';}
  finally{data.products=source;brandPanel();}
 };
 const previousEditor=editProduct;
 editProduct=function(id){
  const product=id?data.products.find(p=>p.id===id):null,current=product?sections.categoryFor(product):'';
  populate($('#pCategory'),current,'Elegí una sección');previousEditor(id);$('#pCategory').value=current;
 };
 const previousSettings=renderSettings;
 renderSettings=function(){
  previousSettings();const form=$('#settingsForm');
  if(!data.settings.instagram)form.elements.instagram.value='azulbendito.tallesgrandes';
  if(/^ELIZABET$/i.test(String(data.settings.brand||'').trim())){
   form.elements.brand.value='AZUL bendito';form.elements.tagline.value='Moda en talles grandes para mujeres reales';
  }
 };
 $('#categoryFilter').addEventListener('change',()=>renderProducts());
 populate($('#pCategory'),'','Elegí una sección');
 if(data.settings.brand)renderProducts();
})();
