(function(root){
 'use strict';
 function cellsFromXML(xml, xmljs){
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('XML com declarações não suportadas.');
  return xmljs.xml2js(xml,{compact:false});
 }
 const elements=(n,name)=>{const out=[];function walk(x){if(x.type==='element'&&x.name.split(':').pop()===name)out.push(x);for(const c of x.elements||[])walk(c);}walk(n);return out;};
 const text=n=>(n.elements||[]).map(c=>c.type==='text'?c.text:text(c)).join('');
 function parseRows(rows){
  const head=rows.findIndex(r=>r.includes('SPX TN')&&r.includes('Latitude'));
  if(head<0)throw Error('Use o romaneio Excel baixado no aplicativo SPX.');
  const cols=rows[head],ix=n=>cols.indexOf(n),required=['AT ID','SPX TN','Destination Address','City','Latitude','Longitude'];
  if(required.some(n=>ix(n)<0))throw Error('O arquivo não tem todas as colunas necessárias.');
  const seen=new Set(),stops=[];let duplicates=0;
  for(const [i,r] of rows.slice(head+1).entries()){
   if(!r.some(x=>String(x||'').trim()))continue;
   const get=n=>String(r[ix(n)]??'').trim(),id=get('SPX TN');
   if(!id||!get('Destination Address'))throw Error('Pedido sem código BR ou endereço na linha '+(head+i+2));
   if(seen.has(id)){duplicates++;continue;}seen.add(id);
   const lat=Number(get('Latitude').replace(',','.')),lon=Number(get('Longitude').replace(',','.'));
   if(!get('Latitude')||!get('Longitude')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||(lat===0&&lon===0))throw Error('Coordenadas inválidas no pedido '+id+'. Confira o romaneio.');
   stops.push({id,at:get('AT ID'),orderRef:id,street:get('Destination Address'),municipality:get('City'),block:get('Bairro'),zip:get('Zipcode/Postal code'),lat,lon,sequence:Number(get('Sequence'))>0?Number(get('Sequence')):null,stop:get('Stop'),done:false,phone:'',km:0,activeMs:0,pauseMs:0});
  }
  if(!stops.length||stops.length>500)throw Error('Importe de 1 a 500 pedidos por vez.');
  return {stops,duplicates,unsequenced:stops.filter(s=>s.sequence===null).length};
 }
 async function read(buffer,Zip,xmljs){
  if(buffer.byteLength>5*1024*1024)throw Error('O arquivo deve ter até 5 MB.');
  // Limit inflated size from ZIP metadata before decompression.
  const bytes=new Uint8Array(buffer),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let expanded=0,entries=0;
  for(let i=0;i+46<bytes.length;i++){if(v.getUint32(i,true)===0x02014b50){expanded+=v.getUint32(i+24,true);entries++;if(expanded>20*1024*1024||entries>1000)throw Error('Romaneio muito grande.');i+=45+v.getUint16(i+28,true)+v.getUint16(i+30,true)+v.getUint16(i+32,true);}}
  const zip=await Zip.loadAsync(buffer);const shared=zip.file('xl/sharedStrings.xml');
  const strings=shared?elements(cellsFromXML(await shared.async('string'),xmljs),'si').map(n=>elements(n,'t').map(text).join('')):[];
  const file=zip.file('xl/worksheets/sheet1.xml');if(!file)throw Error('Primeira planilha não encontrada.');
  const rows=elements(cellsFromXML(await file.async('string'),xmljs),'row').map(row=>{const a=[];for(const c of elements(row,'c')){const ref=c.attributes?.r||'',col=ref.replace(/\d/g,'');let index=0;for(const ch of col)index=index*26+ch.charCodeAt(0)-64;const value=elements(c,'v')[0];a[index-1]=c.attributes?.t==='s'?strings[Number(value?text(value):0)]:c.attributes?.t==='inlineStr'?elements(c,'t').map(text).join(''):value?text(value):'';}return a;});
  return parseRows(rows);
 }
 root.SPXReader={read,parseRows};if(typeof module!=='undefined')module.exports=root.SPXReader;
})(typeof window!=='undefined'?window:globalThis);
