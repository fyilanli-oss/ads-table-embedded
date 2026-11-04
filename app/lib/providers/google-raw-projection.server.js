// Strict bounded JSON projection. Numbers remain original lexical tokens, never
// rounded through Number. Only fields selected by our fixed GAQL enter storage.
const numbers = new WeakSet();
const fail = () => {throw Error("GOOGLE_RAW_RESPONSE_INVALID");};
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
export function parseGoogleRawJson(text) {
 let at=0,nodes=0;
 if(typeof text!=="string"||Buffer.byteLength(text)>16777216)fail();
 const ws=()=>{while(/[\t\n\r ]/.test(text[at]??"!"))at++;};
 function string(){if(text[at]!== '"')fail();const start=at++;
  while(at<text.length){const c=text[at++];if(c==='"'){try{return JSON.parse(text.slice(start,at));}catch{fail();}}if(c==="\\")at++;}fail();}
 function value(depth){if(++nodes>100000||depth>32)fail();ws();const c=text[at];
  if(c==='"')return string();
  if(c==="{"||c==="["){at++;const array=c==="[",out=array?[]:{},keys=new Set(),end=array?"]":"}";ws();
   if(text[at]===end){at++;return out;}
   for(;;){ws();let k;if(!array){k=string();if(keys.has(k)||/^(?:__proto__|constructor|prototype)$/i.test(k))fail();keys.add(k);ws();if(text[at++]!==":")fail();}
    const v=value(depth+1);if(array)out.push(v);else out[k]=v;ws();if(text[at]===end){at++;return out;}if(text[at++]!==",")fail();}}
  for(const [word,v]of [["true",true],["false",false],["null",null]])if(text.startsWith(word,at)){at+=word.length;return v;}
  const token=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at))?.[0];
  if(!token||token.length>1024)fail();at+=token.length;const out={jsonNumber:token};numbers.add(out);return out;
 }
 const out=value(0);ws();if(at!==text.length)fail();return out;
}
export const googleRawScalar = value => numbers.has(value)?value.jsonNumber:value;
const camel = s => s.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
export function projectGoogleRawPage(body,{query,accountId,family,ordinal,requestId}) {
 if(!object(body)||Object.hasOwn(body,"error"))fail();
 if(!Object.hasOwn(body,"results")&&Object.keys(body).some(k=>!["fieldMask","nextPageToken","totalResultsCount","queryResourceConsumption"].includes(k)))fail();
 const rows=body.results??[];if(!Array.isArray(rows))fail();
 const match=/^SELECT\s+([\s\S]+?)\s+FROM\s/i.exec(query);if(!match)fail();
 const fields=match[1].split(",").map(s=>s.trim());
 if(fields.some(f=>!/^([a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/.test(f)))fail();
 const records=rows.map(row=>{
  if(!object(row)||googleRawScalar(row.customer?.id)!==accountId)fail();
  return {fields:fields.flatMap(field=>{let v=row;
   for(const part of field.split(".").map(camel)){if(!object(v)||!Object.hasOwn(v,part))return [];v=v[part];}
   // The listing path is the only selected composite value; other selected
   // fields are scalar. A native numeric-tag lookalike cannot forge a number.
   if(v!==null&&typeof v==="object"&&!numbers.has(v)&&!field.endsWith(".path"))fail();
   return [{field,value:v}];})};
 });
 if(body.nextPageToken!==undefined&&typeof body.nextPageToken!=="string")fail();
 const declaredTotal=Object.hasOwn(body,"totalResultsCount")?googleRawScalar(body.totalResultsCount):null;
 if(declaredTotal!==null&&!/^[0-9]{1,19}$/.test(declaredTotal))fail();
 return {family,ordinal,query,requestId:typeof requestId==="string"&&/^[A-Za-z0-9_-]{1,256}$/.test(requestId)?requestId:null,
  records,selectedFields:fields,hasNextPage:!!body.nextPageToken,declaredTotal};
}
