// Test-only runtime adapter: import production handlers unchanged in native Deno.
// Network permission independently restricts all I/O to the fixture gateway.
const [name, port] = Deno.args;
if (!['portal-document-extract','portal-document-delete','public-assistant','public-assistant-index','cms-admin-users','portal-admin-users'].includes(name)) throw Error('Unknown handler');
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
 const target = new URL(input instanceof Request ? input.url : String(input));
 if (target.origin === 'http://127.0.0.1:55431') return realFetch(input, init);
 if (target.origin !== 'https://api.openai.com' || !['/v1/responses','/v1/embeddings'].includes(target.pathname)) throw Error('External network forbidden by fixture');
 let control = JSON.parse(await Deno.readTextFile('tmp/phase2-native/provider.json'));
 await Deno.writeTextFile('tmp/phase2-native/provider-entered.json',JSON.stringify({handler:name,path:target.pathname}));
 while(control.mode==='hold'){await new Promise(r=>setTimeout(r,100));control=JSON.parse(await Deno.readTextFile('tmp/phase2-native/provider.json'));}
 if(control.mode==='failure')return Response.json({error:{message:'Synthetic temporary failure'}},{status:503});
 if(target.pathname.endsWith('/embeddings'))return Response.json({data:[{embedding:Array.from({length:1536},(_,i)=>i===0?1:0)}],usage:{total_tokens:1}});
 const body=JSON.parse(String(init?.body||'{}'));
 if(body.input?.[0]?.content?.[0]?.text?.startsWith('Extract this public PDF'))return Response.json({id:'synthetic-public-document',output_text:JSON.stringify({pages:[{page:1,text:'Published synthetic public document with a fixture scholarship policy and clear eligibility information.',warnings:[]}]}),usage:{input_tokens:1,output_tokens:1}});
 const fields=body.text?.format?.schema?.properties?.fields?.properties;
 if(fields)return Response.json({id:'synthetic-response',output_text:JSON.stringify({document_type:'Passport',category_mismatch:false,fields:{...Object.fromEntries(Object.keys(fields).map(k=>[k,null])),first_name:'Native',last_name:'Fixture'},evidence:[]}),usage:{input_tokens:1,output_tokens:1}});
 return Response.json({id:'synthetic-rag',output_text:'Published fixture answer.',usage:{input_tokens:1,output_tokens:1}});
};
// Native Deno keeps serving while background promises run; hosted waitUntil lifecycle
// is not represented by this adapter and must not be claimed as a hosted runtime test.
Object.assign(globalThis,{EdgeRuntime:{waitUntil:(promise:Promise<unknown>)=>{promise.catch(()=>{});}}});
const serve=Deno.serve;
Deno.serve=((handler: Deno.ServeHandler)=>serve({hostname:'127.0.0.1',port:Number(port)},handler)) as typeof Deno.serve;
await import(`../../supabase/functions/${name}/index.ts`);
