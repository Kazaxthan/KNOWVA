import fs from 'node:fs';
// Node.js 24 can read .env without requiring installed npm packages.
if(fs.existsSync('.env')){
 if(typeof process.loadEnvFile==='function')process.loadEnvFile('.env');
 else await import('dotenv/config');
}
import {testOpenAIConnection} from '../src/openai-client.js';
const model=process.env.GROQ_MODEL||'openai/gpt-oss-20b';
console.log('KnowVa Groq connectivity test');
console.log('Model:',model);
console.log('API key configured:',Boolean(process.env.GROQ_API_KEY?.trim()));
console.log('No manuscript is sent by this test. A small API charge may apply.');
try{
 const result=await testOpenAIConnection();
 console.log('Result:',result.connected?'CONNECTED':'RESPONSE WITHOUT TEXT');
 console.log('Latency:',result.latencyMs+' ms');
 console.log(result.message);
 if(!result.connected)process.exitCode=1;
}catch(error){
 console.error('Result: FAILED');
 console.error(error.message);
 process.exitCode=1;
}
