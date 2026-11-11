import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import {fileURLToPath} from 'node:url';
import {query,pool} from './services.js';
import {registerRoutes} from './routes.js';
import {registerFullApp} from './full-app.js';
import {securityEvent} from './security.js';

export const app=express();
const production=process.env.NODE_ENV==='production';
if(production&&(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32))throw new Error('Set a strong SESSION_SECRET before production.');
if(production&&process.env.COOKIE_SECURE!=='true')throw new Error('COOKIE_SECURE=true is required behind HTTPS in production.');
if(process.env.TRUST_PROXY==='true')app.set('trust proxy',1);
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({limit:'1mb'}));
const allowed=(process.env.FRONTEND_ORIGIN||'http://localhost:5173').split(',').map(x=>x.trim());
app.use(cors({origin:(origin,cb)=>cb(null,!origin||allowed.includes(origin)),credentials:true}));
app.use(rateLimit({windowMs:15*60*1000,limit:600,standardHeaders:'draft-7',legacyHeaders:false,handler:(req,res)=>{void securityEvent(req,'RATE_LIMITED');res.status(429).json({message:'Too many requests. Try again later.'})}}));
const PgStore=connectPgSimple(session);
app.use(session({
 store:new PgStore({pool,tableName:'session',createTableIfMissing:true}),
 name:'knowva.sid', secret:process.env.SESSION_SECRET||'development_only_replace_with_a_long_random_secret',
 resave:false,saveUninitialized:false,rolling:true,
 cookie:{httpOnly:true,secure:process.env.COOKIE_SECURE==='true',sameSite:'lax',maxAge:8*60*60*1000,path:'/'}
}));
app.use(async (req,res,next)=>{
 try{
  if(!req.session.userId){req.user=null;return next()}
  const {rows}=await query('SELECT * FROM users WHERE user_id=$1 AND active=true',[req.session.userId]);
  if(!rows.length){req.session.userId=null;req.user=null}else req.user=rows[0];next();
 }catch(e){next(e)}
});
app.get('/api/auth/csrf',(req,res)=>{
 if(!req.session.csrf)req.session.csrf=crypto.randomBytes(32).toString('hex');
 res.set('Cache-Control','no-store').json({csrfToken:req.session.csrf});
});
app.use('/api',(req,res,next)=>{
 if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
 const origin=req.get('origin');
 if(origin&&!allowed.includes(origin)){void securityEvent(req,'CSRF_REJECTED');return res.status(403).json({message:'Request origin is not permitted.'});}
 const token=req.get('x-csrf-token');
 if(!req.session.csrf||typeof token!=='string'||token.length!==req.session.csrf.length||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(req.session.csrf))){void securityEvent(req,'CSRF_REJECTED');return res.status(403).json({message:'CSRF token is missing or invalid. Refresh the page and try again.'});}
 next();
});
app.get('/api/health',async(req,res)=>{try{await query('SELECT 1');res.json({status:'ok',database:'connected'})}catch{res.status(503).json({status:'degraded',database:'unavailable'})}});
// Maintenance mode blocks non-admin mutations while preserving reads, logins, and health checks.
app.use('/api',async(req,res,next)=>{
 if(['GET','HEAD','OPTIONS'].includes(req.method)||req.path.startsWith('/auth/'))return next();
 try{
  const {rows}=await query("SELECT setting_value FROM platform_settings WHERE setting_key='general'");
  if(rows[0]?.setting_value?.maintenance&&req.user?.role!=='ADMIN')return res.status(503).json({message:'KnowVa is in maintenance mode. Please try again later.'});
  next();
 }catch(e){next(e)}
});
registerRoutes(app);
registerFullApp(app);
app.use('/api',(req,res)=>res.status(404).json({message:'API route not found.'}));
app.use((error,req,res,next)=>{
 if(error?.code==='LIMIT_FILE_SIZE')return res.status(413).json({message:'File exceeds the upload limit.'});
 const pgCode=error?.code;
 if(pgCode==='23505')return res.status(409).json({message:'A record with those details already exists.'});
 if(pgCode==='23503')return res.status(409).json({message:'This item is referenced by another record.'});
 if(error?.statusCode){if(error.statusCode===403)void securityEvent(req,'ACCESS_DENIED');return res.status(error.statusCode).json({message:error.message});}
 void securityEvent(req,'SERVER_ERROR','CRITICAL');
 console.error('[KnowVa API]',error?.message||error);
 res.status(500).json({message:'Unexpected server error.'});
});
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const port=Number(process.env.PORT||3001);
 app.listen(port,()=>console.log(`KnowVa API listening on http://localhost:${port}`));
}
