import {inTx,query} from './services.js';

const fail=(message,statusCode=502)=>Object.assign(new Error(message),{statusCode});
const numberSetting=(name,fallback,min,max)=>{
 const value=Number(process.env[name]);
 return Number.isInteger(value)&&value>=min&&value<=max?value:fallback;
};
const model=()=>process.env.GROQ_MODEL?.trim()||'openai/gpt-oss-20b';
const limits=()=>({
 perMinute:numberSetting('GROQ_REQUESTS_PER_MINUTE',2,1,5),
 perDay:numberSetting('GROQ_REQUESTS_PER_DAY',40,1,500),
 inputChars:numberSetting('GROQ_MAX_INPUT_CHARS',5000,500,8000),
 outputTokens:numberSetting('GROQ_MAX_OUTPUT_TOKENS',650,100,1500)
});

async function reserveRequest(){
 const {perMinute,perDay}=limits();
 await inTx(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(7263391)');
  await c.query("DELETE FROM ai_usage_requests WHERE started_at < now() - interval '48 hours'");
  const {rows}=await c.query(`SELECT
    count(*) FILTER (WHERE started_at > now()-interval '1 minute')::int AS minute_used,
    count(*)::int AS day_used
    FROM ai_usage_requests WHERE started_at > now()-interval '24 hours'`);
  if(rows[0].minute_used>=perMinute)throw fail(`KnowVa free-tier guard: maximum ${perMinute} Groq requests per minute. Try again in about a minute.`,429);
  if(rows[0].day_used>=perDay)throw fail(`KnowVa free-tier guard: maximum ${perDay} Groq requests per rolling 24 hours. Try again later.`,429);
  await c.query('INSERT INTO ai_usage_requests DEFAULT VALUES');
 });
}

export async function groqUsage(){
 const {rows}=await query(`SELECT
   count(*) FILTER (WHERE started_at > now()-interval '1 minute')::int AS minute_used,
   count(*)::int AS day_used
   FROM ai_usage_requests WHERE started_at > now()-interval '24 hours'`);
 return {model:model(),configured:Boolean(process.env.GROQ_API_KEY?.trim()),limits:limits(),minuteUsed:rows[0].minute_used,dayUsed:rows[0].day_used};
}

export async function openAIRequest(endpoint,payload,{timeoutMs=45000}={}){
 const key=process.env.GROQ_API_KEY?.trim();
 if(!key)throw fail('Groq is not configured. Add GROQ_API_KEY to backend/.env and restart the backend.',503);
 if(!['responses','chat/completions'].includes(endpoint))throw fail('Unsupported AI endpoint.',400);
 const settings=limits();
 const input=payload.input;
 const messages=endpoint==='responses'
  ? (typeof input==='string'?[{role:'user',content:input}]:input)
  : payload.messages;
 if(!Array.isArray(messages)||!messages.length)throw fail('Missing AI request messages.',400);
 const safeMessages=messages.map(m=>({
  role:['system','developer','assistant','user'].includes(m.role)?m.role:'user',
  content:String(m.content??'').slice(0,m.role==='user'?settings.inputChars:2500)
 }));
 const groqModel=model();
 const body={
  model:groqModel,
  messages:safeMessages,
  temperature:payload.temperature===0?0.1:(payload.temperature??0.2),
  max_completion_tokens:Math.min(
   settings.outputTokens,
   Math.max(100,Number(payload.max_output_tokens||payload.max_completion_tokens||settings.outputTokens))
  )
 };
 if(payload.response_format)body.response_format=payload.response_format;
 if(groqModel.startsWith('openai/gpt-oss-'))body.reasoning_effort='low';

 // Every outbound AI request, including connectivity tests, uses the same
 // PostgreSQL-backed global allowance. Reservations count even if Groq errors.
 await reserveRequest();
 let response;
 try{
  response=await fetch('https://api.groq.com/openai/v1/chat/completions',{
   method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
   body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)
  });
 }catch(error){
  throw fail(error?.name==='TimeoutError'||error?.name==='AbortError'
   ?'Groq request timed out.':'Could not reach Groq. Check your internet connection.');
 }
 if(!response.ok){
  let provider={};try{provider=await response.json()}catch{}
  const retry=response.headers.get('retry-after');
  console.warn('[KnowVa Groq]',{status:response.status,code:provider?.error?.code||provider?.error?.type||'unknown'});
  if(response.status===429)throw fail(`Groq free-tier rate or token limit reached. ${retry?'Retry after '+retry+' seconds.':'Check GroqCloud rate limits and try later.'}`,429);
  if(response.status===401)throw fail('Groq rejected GROQ_API_KEY. Check your key.',502);
  if(response.status===403)throw fail('Groq denied access to the model or project.',502);
  if(response.status===404)throw fail('Groq model not found. Check GROQ_MODEL.',502);
  if(response.status===400)throw fail('Groq rejected the request. Check model support and the request format.',502);
  throw fail(`Groq request failed (HTTP ${response.status}).`);
 }
 const data=await response.json();
 // Preserve the old KnowVa callers, which expect either chat completions
 // or the Responses API's output_text field.
 return {...data,output_text:data.choices?.[0]?.message?.content||''};
}

export async function testOpenAIConnection(){
 const start=performance.now();
 const data=await openAIRequest('chat/completions',{
  messages:[{role:'user',content:'Reply with exactly the word READY.'}],
  max_completion_tokens:180
 });
 const output=String(data.output_text||'').trim();
 return {connected:!!output,model:model(),latencyMs:Math.round(performance.now()-start),message:output?'Groq responded successfully.':'Groq responded without readable text.'};
}
