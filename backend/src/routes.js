import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import sharp from 'sharp';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';
import {query,inTx,publicUser,directoryUser,userRow,fullName,hashToken,newToken,emailValid,lowerEmail,safeText,event,notice,permissions,listProjects,parseProjectId,dbStatus,sendEmail,escapeHtml,appUrl,storageDir,saveBytes,removeStored,safeFileName,composeEmail} from './services.js';
import {parseConcept} from './ai.js';
import {testOpenAIConnection,groqUsage} from './openai-client.js';
import {scanInternalCorpus,openAiWritingReview} from './validation.js';
import {securityEvent,loadSecurityOverview} from './security.js';

const asyncRoute=f=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
const bad=(message,status=400)=>{throw Object.assign(new Error(message),{statusCode:status})};
const auth=(req,res,next)=>req.user?next():(void securityEvent(req,'ACCESS_DENIED'),res.status(401).json({message:'Sign in to continue.'}));
const admin=(req,res,next)=>req.user?.role==='ADMIN'?next():(void securityEvent(req,'ACCESS_DENIED'),res.status(403).json({message:'Administrator access required.'}));
const faculty=(req,res,next)=>['FACULTY','REVIEWER','ADMIN'].includes(req.user?.role)?next():(void securityEvent(req,'ACCESS_DENIED'),res.status(403).json({message:'Faculty access required.'}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1}});
const photoUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1}});
const throttle=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false,handler:(req,res)=>{void securityEvent(req,'RATE_LIMITED');res.status(429).json({message:'Too many attempts. Try again later.'})}});
const emailSchema=z.string().email().max(255).refine(emailValid,'A PUP institutional email is required.');
const pwdSchema=z.string().min(10).max(128).regex(/[A-Z]/,'Password needs an uppercase letter.').regex(/[a-z]/,'Password needs a lowercase letter.').regex(/\d/,'Password needs a digit.');
const roleDb={student:'STUDENT',faculty:'FACULTY',admin:'ADMIN'};
const isStrong=p=>pwdSchema.safeParse(p).success;
const parse=zod=>zod.parse;
const schemaFailed=e=> e?.name==='ZodError';
function errorResponse(e,res){if(schemaFailed(e))return res.status(400).json({message:e.errors.map(x=>x.message).join(' ')});throw e}
const splitName=(name)=>{const parts=safeText(name,240).split(/\s+/).filter(Boolean);return {first:parts.slice(0,-1).join(' ')||parts[0]||'',last:parts.length>1?parts.at(-1):''}};
const lookupField = key=>key==='id'?'student_number':'student_number';
const projectRef=p=>parseProjectId(p);
const toId=(req)=>{const id=projectRef(req.params.id||req.params.projectId);if(!id)bad('Invalid research ID.');return id};
const loadProject=async(req,write=false)=>{
 const id=toId(req);const p=await permissions(req.user,id);
 if(!p)bad('Research not found.',404);
 if(!(write?p.write:p.read))bad('You do not have access to this research.',403);
 return {id,permission:p};
};
const canWriteProjectContent=p=>p.admin||p.owner&&['DRAFT','REVISION_REQUESTED','APPLICATION_APPROVED'].includes(p.status);
const verifyEmailHtml=(name,url)=>`<p>Hi ${escapeHtml(name)},</p><p>Verify your KnowVa email address:</p><p><a href="${escapeHtml(url)}">Verify email</a></p><p>This link expires in 24 hours. If you did not request an account, ignore this email.</p>`;
async function makeVerification(uid,email,name){
 const token=newToken();
 await query('INSERT INTO email_verifications(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \u002724 hours\u0027)',[hashToken(token),uid]);
 const url=appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
 try{const mail=await composeEmail('verification',{name,email,url},'Verify your KnowVa account',`Hello ${name}, please verify your KnowVa account using the link below.`,{url,label:'Verify email address'});return await sendEmail(email,mail.subject,mail.html)}catch(e){console.error('Verification email failed:',e.message);return false}
}
async function registerUser(fields,adminMode=false){
 const email=lowerEmail(fields.email),name=safeText(fields.name,240),universityId=safeText(fields.universityId||fields.id,40),role=String(fields.role||'student').toLowerCase();
 if(!emailValid(email))bad('Use your @iskolarngbayan.pup.edu.ph email.');
 if(!name||name.split(/\s+/).length<2)bad('Enter first and last name.');
 if(!universityId)bad('University ID is required.');
 if(!adminMode&&(!['student','faculty'].includes(role)))bad('Only student and faculty can register.');
 if(!roleDb[role])bad('Invalid account role.');
 const pw=fields.password;
 if(!isStrong(pw))bad('Use a 10+ character password with uppercase, lowercase, and a number.');
 const {first,last}=splitName(name);
 const hash=await bcrypt.hash(pw,12);
 const {rows}=await query('INSERT INTO users(first_name,last_name,email,password_hash,role,department,student_number,email_verified,active) VALUES($1,$2,$3,$4,$5,$6,$7,false,true) RETURNING *',[first,last,email,hash,roleDb[role],safeText(fields.department||'Computer Engineering',180),universityId]);
 const verificationSent=await makeVerification(rows[0].user_id,email,name);
 return {...rows[0],verificationSent};
}

export function registerRoutes(app){
 app.post('/api/auth/register',throttle,asyncRoute(async(req,res)=>{
  try{const user=await registerUser(req.body);res.status(202).json({message:user.verificationSent?'Account created. Verify your institutional email using the link we sent.':'Account created, but email could not be sent. Ask the system administrator to configure SMTP. In development, check the backend terminal for the verification link.'})}catch(e){errorResponse(e,res)}
 }));
 app.get('/api/auth/verify-email',asyncRoute(async(req,res)=>{
  const token=String(req.query.token||'');if(token.length<20)bad('Invalid verification link.',400);
  const found=await inTx(async c=>{
   const {rows}=await c.query('SELECT * FROM email_verifications WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',[hashToken(token)]);
   if(!rows.length)return false;
   await c.query('UPDATE users SET email_verified=true,updated_at=now() WHERE user_id=$1',[rows[0].user_id]);
   await c.query('UPDATE email_verifications SET consumed_at=now() WHERE token_hash=$1',[hashToken(token)]);
   await event(c,rows[0].user_id,'AUTH_EMAIL_VERIFIED','user',rows[0].user_id);return true;
  });
  if(!found)bad('Verification link expired or already used.',400);
  res.json({verified:true,message:'Email verified. You can sign in.'});
 }));
 app.post('/api/auth/login',throttle,asyncRoute(async(req,res)=>{
  const email=lowerEmail(req.body?.email),pwd=req.body?.password;
  if(!email||typeof pwd!=='string')bad('Email and password are required.');
  const {rows}=await query('SELECT * FROM users WHERE lower(email)=$1',[email]);
  const u=rows[0];const dummy='$2a$12$w6rxIeM.wvJfi51W9saEeODMOwoClpVDTr3cZ7KMjoPlW.xCU26X6';
  const ok=await bcrypt.compare(pwd,u?.password_hash||dummy).catch(()=>false);
  if(!u||!ok){await securityEvent(req,'LOGIN_FAILED');bad('Invalid email or password.',401);}
  if(!u.active){await securityEvent(req,'LOGIN_BLOCKED');bad('This account is disabled.',403);}
  if(!u.email_verified){await securityEvent(req,'LOGIN_BLOCKED');bad('Verify your institutional email before signing in.',403);}
  await new Promise((resolve,reject)=>req.session.regenerate(err=>err?reject(err):resolve()));
  req.session.userId=u.user_id;
  await new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));
  await inTx(async c=>event(c,u.user_id,'AUTH_LOGIN','user',u.user_id,{},req.ip));
  res.json({user:publicUser(u)});
 }));
 app.get('/api/auth/me',auth,(req,res)=>res.json({user:publicUser(req.user)}));
 app.post('/api/auth/logout',auth,asyncRoute(async(req,res)=>{
  await new Promise((resolve,reject)=>req.session.destroy(e=>e?reject(e):resolve()));
  res.clearCookie('knowva.sid',{path:'/'}).status(204).end();
 }));
 app.get('/api/directory',auth,asyncRoute(async(req,res)=>{
  const {rows}=await query("SELECT user_id,first_name,last_name,email,role,department,student_number,active,email_verified,avatar_url,created_at FROM users WHERE active=true AND email_verified=true AND role IN ('STUDENT','FACULTY') ORDER BY last_name ASC LIMIT 500");
  res.json({items:rows.map(directoryUser)});
 }));
 app.get('/api/users',auth,admin,asyncRoute(async(req,res)=>{
  const {rows}=await query('SELECT * FROM users ORDER BY created_at DESC LIMIT 1000');res.json({users:rows.map(directoryUser)});
 }));
 app.post('/api/users',auth,admin,asyncRoute(async(req,res)=>{
  const {rows:existing}=await query('SELECT user_id FROM users WHERE email=$1',[lowerEmail(req.body.email)]);
  if(existing.length)bad('Email already exists.',409);
  const user=await registerUser({...req.body,universityId:req.body.id,password:req.body.password},true);
  await inTx(c=>event(c,req.user.user_id,'ADMIN_USER_CREATED','user',user.user_id));
  res.status(201).json({user:directoryUser(user),message:user.verificationSent?'User created; verification email sent.':'User created, but verification email was not sent. Configure SMTP before external deployment.'});
 }));
 app.patch('/api/users/me',auth,asyncRoute(async(req,res)=>{
  const {name,department,email}=req.body||{};
  if(email&&lowerEmail(email)!==req.user.email)bad('Email changes require a separate verification workflow; contact an administrator.',400);
  if(!safeText(name))bad('Name is required.');
  const {first,last}=splitName(name);
  const {rows}=await query('UPDATE users SET first_name=$1,last_name=$2,department=$3,updated_at=now() WHERE user_id=$4 RETURNING *',[first,last,safeText(department,180),req.user.user_id]);
  res.json({user:directoryUser(rows[0])});
 }));
 app.patch('/api/users/:id',auth,admin,asyncRoute(async(req,res)=>{
  const ident=req.params.id;
  const current=(await query('SELECT * FROM users WHERE (user_id::text=$1 OR lower(email)=$2) LIMIT 1',[/^\d+$/.test(ident)?ident:'-1',lowerEmail(ident)])).rows[0];
  if(!current)bad('User not found.',404);
  const payload=req.body||{};
  if(payload.role && !roleDb[payload.role])bad('Invalid role.');
  if(payload.email&&lowerEmail(payload.email)!==current.email)bad('Email changes require verification and are disabled for admin quick-edit.');
  if(current.user_id===req.user.user_id && (payload.active===false||payload.role&&payload.role!=='admin'))bad('You cannot disable or demote your own admin account.');
  const {first,last}=splitName(payload.name||fullName(current));
  const {rows}=await inTx(async c=>{
   const x=await c.query('UPDATE users SET first_name=$1,last_name=$2,student_number=$3,department=$4,role=$5,active=$6,updated_at=now() WHERE user_id=$7 RETURNING *',[first,last,safeText(payload.id||current.student_number,40)||null,safeText(payload.department??current.department,180),roleDb[payload.role]||current.role,typeof payload.active==='boolean'?payload.active:current.active,current.user_id]);
   await event(c,req.user.user_id,'ADMIN_USER_UPDATED','user',current.user_id,{role:x.rows[0].role,active:x.rows[0].active});return x.rows;
  });
  res.json({user:directoryUser(rows[0])});
 }));
 app.put('/api/users/me/avatar',auth,photoUpload.single('avatar'),asyncRoute(async(req,res)=>{
  if(!req.file)bad('Choose an image.');
  let data;
  try{data=await sharp(req.file.buffer,{limitInputPixels:15e6}).rotate().resize(256,256,{fit:'cover'}).jpeg({quality:80}).toBuffer()}catch{bad('Invalid or unsupported image file.')}
  const fileName=await saveBytes(data,'.jpg');
  const old=req.user.avatar_url||'';
  try{await query('UPDATE users SET avatar_url=$1,updated_at=now() WHERE user_id=$2',[`/api/avatars/${fileName}`,req.user.user_id]);if(old.startsWith('/api/avatars/'))await removeStored(path.basename(old))}
  catch(e){await removeStored(fileName);throw e}
  res.json({avatarUrl:`/api/avatars/${fileName}`});
 }));
 app.get('/api/avatars/:file',asyncRoute(async(req,res)=>{
  const file=req.params.file;if(!/^[a-f0-9-]{36}\.jpg$/i.test(file))bad('Not found.',404);
  const db=await query('SELECT 1 FROM users WHERE avatar_url=$1 LIMIT 1',[`/api/avatars/${file}`]);
  if(!db.rowCount)bad('Not found.',404);
  res.type('image/jpeg').set('Cache-Control','public,max-age=300').sendFile(path.join(storageDir,file));
 }));
 app.delete('/api/users/me/avatar',auth,asyncRoute(async(req,res)=>{
  const old=req.user.avatar_url||'';await query('UPDATE users SET avatar_url=NULL WHERE user_id=$1',[req.user.user_id]);if(old.startsWith('/api/avatars/'))await removeStored(path.basename(old));res.status(204).end();
 }));

 app.get('/api/projects',auth,asyncRoute(async(req,res)=>res.json({projects:await listProjects(req.user)})));
 app.get('/api/projects/:id',auth,asyncRoute(async(req,res)=>{
  const {id}=await loadProject(req);
  const items=await listProjects(req.user);res.json({project:items.find(p=>p.databaseId===id)});
 }));
 app.post('/api/projects',auth,asyncRoute(async(req,res)=>{
  const b=req.body||{};if(!safeText(b.title)||safeText(b.title).length<5)bad('Research title must be at least five characters.');
  if(b.submit)bad('Create as a draft, upload real documents, then submit.');
  const p=await inTx(async c=>{
   const {rows}=await c.query('INSERT INTO research_projects(lead_researcher_id,title,abstract,keywords,status) VALUES($1,$2,$3,$4,\u0027DRAFT\u0027) RETURNING *',[req.user.user_id,safeText(b.title,500),safeText(b.abstract,12000),safeText(b.keywords,2000)]);
   const id=rows[0].project_id;
   let advisor=null;
   if(b.advisorEmail){const {rows:u}=await c.query("SELECT user_id FROM users WHERE email=$1 AND active AND email_verified AND role IN ('FACULTY','REVIEWER')",[lowerEmail(b.advisorEmail)]);if(!u.length)bad('Selected faculty adviser is not a verified account.');advisor=u[0].user_id}
   await c.query('INSERT INTO project_details(project_id,research_type,category,department,objectives,advisor_id,sections) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,safeText(b.type,160)||'Unspecified',safeText(b.category,160)||'Uncategorized',safeText(b.department,160)||'Computer Engineering',safeText(b.objectives,8000),advisor,JSON.stringify(b.sections&&typeof b.sections==='object'&&!Array.isArray(b.sections)?b.sections:{})]);
   const ownerName=fullName(req.user);
   const {rows:lead}=await c.query('INSERT INTO project_authors(project_id,user_id,author_name,author_order,is_corresponding,affiliation) VALUES($1,$2,$3,1,true,$4) RETURNING author_id',[id,req.user.user_id,ownerName,safeText(req.user.department,160)]);
   await c.query('INSERT INTO author_details(author_id,contribution,email,link_status) VALUES($1,$2,$3,$4)',[lead[0].author_id,'Lead Author',req.user.email,'Linked']);
   await replaceAuthors(c,id,b.authors||[],req.user);
   await c.query('INSERT INTO workflow_history(project_id,action_by_user_id,stage_name,action_taken) VALUES($1,$2,$3,$4)',[id,req.user.user_id,'Draft','Draft created']);
   await event(c,req.user.user_id,'PROJECT_CREATED','research',id);if(advisor)await notice(c,advisor,'New advisee research',`${ownerName} assigned you to review research: ${safeText(b.title,160)}`);
   return id;
  });
  const projects=await listProjects(req.user);res.status(201).json({project:projects.find(x=>x.databaseId===p)});
 }));
 app.patch('/api/projects/:id',auth,asyncRoute(async(req,res)=>{
  const {id,permission}=await loadProject(req,true);
  const b=req.body||{};
  const old=permission.status;
  const statusRequested=typeof b.status==='string'&&b.status.length>0;
  const desired=statusRequested?dbStatus(b.status):old;
  if(statusRequested&&!desired)bad('Unsupported research status.');
  if(statusRequested&&desired!==old){
   const ownerTransition=permission.owner&&((old==='DRAFT'||old==='REVISION_REQUESTED')&&desired==='SUBMITTED');
   if(!permission.admin&&!ownerTransition)bad('Only an administrator can approve screening or change the formal review/publication status.',403);
   const allowed={DRAFT:['SUBMITTED'],SUBMITTED:['SCREENING','APPLICATION_APPROVED','REVISION_REQUESTED'],SCREENING:['APPLICATION_APPROVED','REVISION_REQUESTED'],REVISION_REQUESTED:['SUBMITTED'],APPLICATION_APPROVED:['UNDER_REVIEW','REVISION_REQUESTED','SUBMITTED_TO_CONFERENCE'],UNDER_REVIEW:['APPROVED','REJECTED','REVISION_REQUESTED'],APPROVED:['SUBMITTED_TO_CONFERENCE','PUBLISHED'],SUBMITTED_TO_CONFERENCE:['PUBLISHED','REVISION_REQUESTED'],REJECTED:[],PUBLISHED:[]};
   if(!(allowed[old]||[]).includes(desired))bad(`Invalid workflow transition: ${old} -> ${desired}.`);
  }
  const contentKeys=['title','abstract','keywords','objectives','type','category','department','sections','advisorEmail','authors'];
  if(contentKeys.some(k=>Object.hasOwn(b,k))&&!canWriteProjectContent(permission))bad('This research cannot be edited in its current status.',403);
  if(Object.hasOwn(b,'sections')&&(typeof b.sections!=='object'||Array.isArray(b.sections)||b.sections===null))bad('Invalid manuscript sections.');
  if(Object.hasOwn(b,'authors')&&!Array.isArray(b.authors))bad('Invalid author list.');
  if(desired==='SUBMITTED'&&old!==desired){
   const {rows}=await query('SELECT count(*)::int AS count FROM uploaded_files WHERE project_id=$1',[id]);
   if(!rows[0].count)bad('At least one real document must be uploaded before submission.');
  }
  if(Object.hasOwn(b,'stage')&&(!statusRequested||desired===old)&&!permission.admin){
   if(!(permission.owner&&old==='APPLICATION_APPROVED'&&['Authorship Review','Manuscript Development','Validation Pending'].includes(b.stage)))bad('You cannot change this workflow stage.',403);
  }
  await inTx(async c=>{
   const oldrow=(await c.query('SELECT * FROM research_projects WHERE project_id=$1 FOR UPDATE',[id])).rows[0];
   const title=Object.hasOwn(b,'title')?safeText(b.title,500):oldrow.title;
   if(!title)bad('Title cannot be empty.');
   await c.query('UPDATE research_projects SET title=$1,abstract=$2,keywords=$3,status=$4,updated_at=now() WHERE project_id=$5',[title,Object.hasOwn(b,'abstract')?safeText(b.abstract,12000):oldrow.abstract,Object.hasOwn(b,'keywords')?safeText(b.keywords,2000):oldrow.keywords,desired,id]);
   const details=(await c.query('SELECT * FROM project_details WHERE project_id=$1 FOR UPDATE',[id])).rows[0];
   let advisor=details?.advisor_id||null;
   if(Object.hasOwn(b,'advisorEmail')){
    if(b.advisorEmail){const rr=await c.query("SELECT user_id FROM users WHERE email=$1 AND role IN ('FACULTY','REVIEWER') AND active AND email_verified",[lowerEmail(b.advisorEmail)]);if(!rr.rowCount)bad('Adviser must be a verified faculty account.');advisor=rr.rows[0].user_id}
    else advisor=null;
   }
   const sections=Object.hasOwn(b,'sections')?Object.fromEntries(Object.entries(b.sections).slice(0,30).map(([k,v])=>[safeText(k,50),safeText(v,20000)])):details?.sections||{};
   const stage=Object.hasOwn(b,'stage')?safeText(b.stage,120):details?.stage||'Draft';
   const resume=Object.hasOwn(b,'resumeStage')?safeText(b.resumeStage,120):details?.resume_stage||null;
   await c.query('INSERT INTO project_details(project_id,research_type,category,department,objectives,advisor_id,stage,resume_stage,sections) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (project_id) DO UPDATE SET research_type=EXCLUDED.research_type,category=EXCLUDED.category,department=EXCLUDED.department,objectives=EXCLUDED.objectives,advisor_id=EXCLUDED.advisor_id,stage=EXCLUDED.stage,resume_stage=EXCLUDED.resume_stage,sections=EXCLUDED.sections',[id,Object.hasOwn(b,'type')?safeText(b.type,160):details?.research_type||'Unspecified',Object.hasOwn(b,'category')?safeText(b.category,160):details?.category||'Uncategorized',Object.hasOwn(b,'department')?safeText(b.department,160):details?.department||'Computer Engineering',Object.hasOwn(b,'objectives')?safeText(b.objectives,8000):details?.objectives||'',advisor,stage,resume,JSON.stringify(sections)]);
   if(Object.hasOwn(b,'authors'))await replaceAuthors(c,id,b.authors,req.user);
   await c.query('INSERT INTO workflow_history(project_id,action_by_user_id,stage_name,action_taken) VALUES($1,$2,$3,$4)',[id,req.user.user_id,stage,statusRequested?`Status updated: ${b.status}`:'Research details updated']);
   await event(c,req.user.user_id,'PROJECT_UPDATED','research',id,{status:desired,stage});
   if(statusRequested&&desired!==old&&oldrow.lead_researcher_id!==req.user.user_id)await notice(c,oldrow.lead_researcher_id,'Research status changed',`${title}: ${b.status}`,'review');
  });
  const projects=await listProjects(req.user);res.json({project:projects.find(x=>x.databaseId===id)});
 }));

 app.post('/api/projects/:id/files',auth,upload.single('file'),asyncRoute(async(req,res)=>{
  const {id,permission}=await loadProject(req,true);
  if(!canWriteProjectContent(permission))bad('Uploads are locked for this research.',403);
  if(!req.file)bad('Please select a file.');
  const allowed={'.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.txt':'text/plain'};
  const ext=path.extname(req.file.originalname).toLowerCase();
  if(!allowed[ext])bad('Only PDF, DOCX, XLSX and TXT files are allowed.');
  const buf=req.file.buffer;
  if(ext==='.pdf'&&!buf.subarray(0,5).equals(Buffer.from('%PDF-')))bad('File is not a valid PDF.');
  if(['.docx','.xlsx'].includes(ext)&&!buf.subarray(0,2).equals(Buffer.from('PK')))bad('Office document has an invalid signature.');
  if(ext==='.txt'&&buf.includes(0))bad('Invalid text file.');
  const purpose=req.body?.purpose==='manuscript'?'manuscript':'supporting';
  const name=await saveBytes(buf,ext);
  let fid;
  try{
   fid=await inTx(async c=>{
    const {rows}=await c.query('INSERT INTO uploaded_files(project_id,uploaded_by,file_name,disk_name,mime_type,size_bytes,purpose) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING file_id',[id,req.user.user_id,safeFileName(req.file.originalname),name,allowed[ext],buf.length,purpose]);
    if(purpose==='manuscript'){
     const version=Number((await c.query('SELECT coalesce(max(version_number),0)+1 AS version FROM manuscripts WHERE project_id=$1',[id])).rows[0].version);
     await c.query('INSERT INTO manuscripts(project_id,version_number,file_url) VALUES($1,$2,$3)',[id,version,`/api/projects/${id}/files/${rows[0].file_id}`]);
    }
    await event(c,req.user.user_id,'FILE_UPLOADED','research',id,{fileId:rows[0].file_id,purpose});return rows[0].file_id;
   });
  }catch(e){await removeStored(name);throw e}
  res.status(201).json({file:{id:fid,name:req.file.originalname,size:buf.length,purpose,url:`/api/projects/${id}/files/${fid}`}});
 }));
 app.get('/api/projects/:id/files/:fileId',auth,asyncRoute(async(req,res)=>{
  const {id}=await loadProject(req);
  const {rows}=await query('SELECT * FROM uploaded_files WHERE file_id=$1 AND project_id=$2',[req.params.fileId,id]);
  if(!rows.length)bad('File not found.',404);
  const f=rows[0];res.set('Cache-Control','private,no-store').download(path.join(storageDir,f.disk_name),f.file_name);
 }));
 app.delete('/api/projects/:id/files/:fileId',auth,asyncRoute(async(req,res)=>{
  const {id,permission}=await loadProject(req,true);
  if(!canWriteProjectContent(permission))bad('Uploads are locked.',403);
  const r=await inTx(async c=>{
   const {rows}=await c.query('DELETE FROM uploaded_files WHERE file_id=$1 AND project_id=$2 RETURNING *',[req.params.fileId,id]);
   if(rows.length){await c.query('DELETE FROM manuscripts WHERE file_url=$1',[`/api/projects/${id}/files/${rows[0].file_id}`]);await event(c,req.user.user_id,'FILE_DELETED','research',id,{fileId:rows[0].file_id})}
   return rows[0];
  });
  if(!r)bad('File not found.',404);await removeStored(r.disk_name);res.status(204).end();
 }));

 app.get('/api/reviews',auth,asyncRoute(async(req,res)=>{
  const {rows}=await query(`SELECT r.review_id,r.review_status::text,r.reviewer_id,r.reviewed_at,r.comments,m.project_id,p.title,p.created_at AS project_created_at,p.lead_researcher_id,u.email AS reviewer_email,u.first_name||' '||u.last_name AS reviewer_name,lead.first_name||' '||lead.last_name AS lead_name,e.recommendation,e.scores,e.revisions,e.final
 FROM peer_reviews r JOIN manuscripts m ON m.manuscript_id=r.manuscript_id JOIN research_projects p ON p.project_id=m.project_id JOIN users u ON u.user_id=r.reviewer_id JOIN users lead ON lead.user_id=p.lead_researcher_id LEFT JOIN review_evaluations e ON e.project_id=p.project_id AND e.reviewer_id=r.reviewer_id WHERE r.reviewer_id=$1 OR $2::boolean ORDER BY r.review_id DESC`,[req.user.user_id,req.user.role==='ADMIN']);
  res.json({reviews:rows.map(r=>({id:`RES-${new Date(r.project_created_at).getFullYear()}-${String(r.project_id).padStart(4,'0')}`,reviewId:r.review_id,projectId:r.project_id,reviewerEmail:r.reviewer_email,reviewerName:r.reviewer_name,lead:r.lead_name,title:r.title,status:r.final?'Completed':r.review_status==='ASSIGNED'?'New Assignment':r.review_status==='IN_PROGRESS'?'In Progress':'Completed',recommendation:r.recommendation||null,scores:r.scores||{},comments:r.comments||'',revisions:r.revisions||'',assigned:'Assigned',deadline:'Not set'}))});
 }));
 app.post('/api/reviews/:projectId/evaluation',auth,faculty,asyncRoute(async(req,res)=>{
  const id=toId(req),b=req.body||{};
  const recs=['Accept','Minor Revision','Major Revision','Reject'];if(!recs.includes(b.recommendation))bad('Invalid reviewer recommendation.');
  const scores=b.scores||{};
  if(typeof scores!=='object'||Object.values(scores).some(v=>!Number.isInteger(Number(v))||Number(v)<1||Number(v)>5))bad('Scores must be between 1 and 5.');
  const {rows}=await query('SELECT r.review_id,r.review_status::text,p.lead_researcher_id FROM peer_reviews r JOIN manuscripts m ON m.manuscript_id=r.manuscript_id JOIN research_projects p ON p.project_id=m.project_id WHERE m.project_id=$1 AND r.reviewer_id=$2 ORDER BY r.review_id DESC LIMIT 1',[id,req.user.user_id]);
  if(!rows.length)bad('You are not assigned to this review.',403);
  if(['APPROVED','REJECTED','REVISION_REQUIRED'].includes(rows[0].review_status))bad('This review was already finalized.',409);
  await inTx(async c=>{
   await c.query('INSERT INTO review_evaluations(project_id,reviewer_id,recommendation,scores,comments,revisions,final) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(project_id,reviewer_id) DO UPDATE SET recommendation=EXCLUDED.recommendation,scores=EXCLUDED.scores,comments=EXCLUDED.comments,revisions=EXCLUDED.revisions,final=EXCLUDED.final,updated_at=now()',[id,req.user.user_id,b.recommendation,JSON.stringify(scores),safeText(b.comments,8000),safeText(b.revisions,8000),Boolean(b.final)]);
   if(b.final){
    const reviewStatus=b.recommendation==='Accept'?'APPROVED':b.recommendation==='Reject'?'REJECTED':'REVISION_REQUIRED';
    await c.query('UPDATE peer_reviews SET review_status=$1,comments=$2,reviewed_at=now() WHERE review_id=$3',[reviewStatus,safeText(b.comments,8000),rows[0].review_id]);
    const decisions=await c.query(`SELECT r.review_status::text AS result FROM peer_reviews r JOIN manuscripts m ON m.manuscript_id=r.manuscript_id
     WHERE m.manuscript_id=(SELECT manuscript_id FROM manuscripts WHERE project_id=$1 ORDER BY version_number DESC LIMIT 1)`,[id]);
    const allComplete=decisions.rows.length>0&&decisions.rows.every(x=>['APPROVED','REJECTED','REVISION_REQUIRED'].includes(x.result));
    if(allComplete){
     const statuses=decisions.rows.map(x=>x.result);
     const projectStatus=statuses.includes('REJECTED')?'REJECTED':statuses.includes('REVISION_REQUIRED')?'REVISION_REQUESTED':'APPROVED';
     const stage=projectStatus==='APPROVED'?'Conference Preparation':projectStatus==='REJECTED'?'Rejected':'Manuscript Revision';
     await c.query('UPDATE research_projects SET status=$1,updated_at=now() WHERE project_id=$2',[projectStatus,id]);
     await c.query('INSERT INTO project_details(project_id,stage,resume_stage) VALUES($1,$2,$3) ON CONFLICT (project_id) DO UPDATE SET stage=EXCLUDED.stage,resume_stage=EXCLUDED.resume_stage',[id,stage,'Validation Pending']);
    }
    await c.query('INSERT INTO workflow_history(project_id,action_by_user_id,stage_name,action_taken,remarks) VALUES($1,$2,$3,$4,$5)',[id,req.user.user_id,'Peer Review',`Review submitted: ${b.recommendation}`,safeText(b.comments,8000)]);
    await notice(c,rows[0].lead_researcher_id,'Peer review received',allComplete?'All assigned reviewers have submitted final recommendations.':'A reviewer submitted a recommendation; other reviews may remain pending.','review');
   }else await c.query("UPDATE peer_reviews SET review_status='IN_PROGRESS' WHERE review_id=$1",[rows[0].review_id]);
   await event(c,req.user.user_id,b.final?'REVIEW_FINALIZED':'REVIEW_DRAFT_SAVED','research',id);
  });
  const all=await listProjects(req.user);const p=all.find(x=>x.databaseId===id);
  res.json({review:{id:p?.id||req.params.projectId,reviewerEmail:req.user.email,status:b.final?'Completed':'In Progress',recommendation:b.recommendation,scores,comments:b.comments,revisions:b.revisions},project:p});
 }));
 app.post('/api/projects/:id/assign-reviewer',auth,admin,asyncRoute(async(req,res)=>{
  const {id,permission}=await loadProject(req,true);
  if(!['APPLICATION_APPROVED','UNDER_REVIEW'].includes(permission.status))bad('Only an approved research application may enter peer review. Complete screening and journal preparation first.',409);
  const reviewerEmail=lowerEmail(req.body?.email);
  const {rows:u}=await query("SELECT u.user_id,u.email FROM users u WHERE u.email=$1 AND u.active AND u.email_verified AND u.role IN ('FACULTY','REVIEWER')",[reviewerEmail]);
  if(!u.length)bad('Reviewer must be an active verified faculty user.');
  if(!(await query('SELECT 1 FROM reviewer_certifications WHERE user_id=$1',[u[0].user_id])).rowCount)bad('Certify the faculty member in Reviewer Pool before assigning a review.',409);
  await inTx(async c=>{
   const {rows:m}=await c.query('SELECT manuscript_id FROM manuscripts WHERE project_id=$1 ORDER BY version_number DESC LIMIT 1',[id]);
   if(!m.length)bad('Upload a manuscript before assigning a reviewer.');
   const d=await c.query('SELECT setting_value FROM platform_settings WHERE setting_key=$1',['general']);const max=Number(d.rows[0]?.setting_value?.maxLoad||5);
   const {rows:load}=await c.query("SELECT count(*)::int AS total FROM peer_reviews WHERE reviewer_id=$1 AND review_status IN ('ASSIGNED','IN_PROGRESS')",[u[0].user_id]);
   if(load[0].total>=max)bad('Reviewer is at maximum active assignment capacity.',409);
   const prior=await c.query('SELECT 1 FROM peer_reviews WHERE manuscript_id=$1 AND reviewer_id=$2',[m[0].manuscript_id,u[0].user_id]);if(prior.rowCount)bad('Reviewer is already assigned to this manuscript.',409);
   await c.query('INSERT INTO peer_reviews(manuscript_id,reviewer_id) VALUES($1,$2)',[m[0].manuscript_id,u[0].user_id]);
   await c.query("UPDATE research_projects SET status='UNDER_REVIEW',updated_at=now() WHERE project_id=$1 AND status='APPLICATION_APPROVED'",[id]);
   await c.query("UPDATE project_details SET stage='Manuscript Review' WHERE project_id=$1",[id]);
   await c.query('INSERT INTO workflow_history(project_id,action_by_user_id,stage_name,action_taken) VALUES($1,$2,$3,$4)',[id,req.user.user_id,'Peer Review',`Reviewer assigned: ${reviewerEmail}`]);
   await notice(c,u[0].user_id,'New review assignment',`You have been assigned research ${id}`,'review');await event(c,req.user.user_id,'REVIEW_ASSIGNED','research',id,{reviewerId:u[0].user_id});
  });
  let delivered=false;
  try{const mail=await composeEmail('review',{name:reviewerEmail,email:reviewerEmail,project:String(id)},'KnowVa review assignment',`You have been assigned to review research ${id}. Sign in to KnowVa to evaluate the manuscript.`,{url:appUrl('/app/assigned'),label:'Open review assignments'});delivered=await sendEmail(reviewerEmail,mail.subject,mail.html)}catch(e){console.error('Reviewer assignment email failed:',e.message)}
  res.status(201).json({message:delivered?'Reviewer assigned and email sent.':'Reviewer assigned; in-app notification saved. Email delivery unavailable until SMTP is configured.',emailSent:delivered});
 }));
 app.delete('/api/projects/:id',auth,asyncRoute(async(req,res)=>{
  const {id,permission}=await loadProject(req,true);
  if(!permission.admin&&!(permission.owner&&permission.status==='DRAFT'))bad('Only owners can delete drafts. Administrators can manage other records.',403);
  const {rows:files}=await query('SELECT disk_name FROM uploaded_files WHERE project_id=$1',[id]);
  await inTx(async c=>{await event(c,req.user.user_id,'PROJECT_DELETED','research',id);await c.query('DELETE FROM research_projects WHERE project_id=$1',[id])});
  await Promise.all(files.map(f=>removeStored(f.disk_name)));
  res.status(204).end();
 }));
 app.get('/api/invitations',auth,asyncRoute(async(req,res)=>{
  const {rows}=await query(`SELECT i.*,p.title AS project_title,p.created_at AS project_created_at FROM invitations i JOIN research_projects p ON p.project_id=i.project_id WHERE i.invited_by=$1 OR $2::boolean ORDER BY i.created_at DESC LIMIT 200`,[req.user.user_id,req.user.role==='ADMIN']);
  res.json({invitations:rows.map(i=>({id:String(i.invitation_id),projectId:`RES-${new Date(i.project_created_at).getFullYear()}-${String(i.project_id).padStart(4,'0')}`,name:i.invited_name,email:i.invited_email,role:i.contribution,type:i.collaborator_type,status:i.status,createdAt:i.created_at,expiresAt:i.expires_at}))});
 }));
 app.post('/api/projects/:id/invitations',auth,throttle,asyncRoute(async(req,res)=>{
  const {id,permission}=await loadProject(req,true);
  if(!permission.owner&&!permission.admin)bad('Only the project owner can invite co-authors.',403);
  const b=req.body||{},name=safeText(b.name,250),email=lowerEmail(b.email);
  if(!name||!emailValid(email))bad('Enter a name and a valid PUP email.');
  const existing=await query('SELECT 1 FROM project_authors a JOIN users u ON u.user_id=a.user_id WHERE a.project_id=$1 AND u.email=$2',[id,email]);
  if(existing.rowCount)bad('This researcher is already linked.',409);
  const token=newToken(),expires=new Date(Date.now()+7*86400000);
  const inv=await inTx(async c=>{
   const {rows}=await c.query('INSERT INTO invitations(project_id,invited_by,invited_name,invited_email,contribution,collaborator_type,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,req.user.user_id,name,email,safeText(b.role,100)||'Co-Author',safeText(b.type,40)||'Internal',hashToken(token),expires]);
   await event(c,req.user.user_id,'AUTHOR_INVITED','research',id,{invitee:email});return rows[0];
  });
  let status='queued';
  const url=appUrl(`/invitations/accept/${encodeURIComponent(token)}`);
  try{const mail=await composeEmail('invitation',{name,email,url,inviter:fullName(req.user),project:String(id),role:inv.contribution},'KnowVa Research Collaboration Invitation',`${fullName(req.user)} invited you to collaborate on research ${id} as ${inv.contribution}. The invitation expires in 7 days.`,{url,label:'Accept research invitation'});if(await sendEmail(email,mail.subject,mail.html)){
   status='sent';await query("UPDATE invitations SET status='sent',sent_at=now() WHERE invitation_id=$1",[inv.invitation_id]);
  }}catch(e){status='failed';await query("UPDATE invitations SET status='failed' WHERE invitation_id=$1",[inv.invitation_id]);console.error('Invite delivery failed:',e.message)}
  res.status(202).json({invitation:{id:String(inv.invitation_id),name,email,role:inv.contribution,type:inv.collaborator_type,projectId:req.params.id,status:status==='sent'?'Sent':status==='queued'?'Queued':'Failed',expiresAt:expires},message:status==='sent'?'Invitation email accepted by SMTP server.':status==='queued'?'Invitation saved, but SMTP is not configured; no email was sent.':'Email delivery failed.'});
 }));
 app.get('/api/invitations/validate',asyncRoute(async(req,res)=>{
  const token=String(req.query.token||'');if(token.length<20)bad('Invalid invitation.',400);
  const {rows}=await query("SELECT i.*,p.title AS project_title,p.created_at AS project_created_at FROM invitations i JOIN research_projects p ON p.project_id=i.project_id WHERE i.token_hash=$1 AND i.status IN ('queued','sent') AND i.expires_at>now()",[hashToken(token)]);
  if(!rows.length)bad('Invitation expired or already used.',404);
  const i=rows[0],parts=i.invited_email.split('@');
  res.json({invitation:{projectId:i.project_id,projectTitle:i.project_title,role:i.contribution,emailMasked:parts[0].slice(0,2)+'***@'+parts[1],expiresAt:i.expires_at}});
 }));
 app.post('/api/invitations/accept',auth,asyncRoute(async(req,res)=>{
  const token=String(req.body?.token||'');if(token.length<20)bad('Invalid invitation.');
  const result=await inTx(async c=>{
   const {rows}=await c.query('SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE',[hashToken(token)]);
   const i=rows[0];if(!i||!['queued','sent'].includes(i.status)||new Date(i.expires_at)<new Date())bad('Invitation expired or already accepted.',409);
   if(i.invited_email!==req.user.email)bad('Sign in using the invited email address.',403);
   if(!req.user.email_verified)bad('Verify your email before accepting.',403);
   const taken=await c.query('SELECT author_id FROM project_authors WHERE project_id=$1 AND user_id=$2',[i.project_id,req.user.user_id]);
   if(!taken.rowCount){
    const {rows:a}=await c.query('INSERT INTO project_authors(project_id,user_id,author_name,author_order,affiliation) VALUES($1,$2,$3,(SELECT coalesce(max(author_order),0)+1 FROM project_authors WHERE project_id=$1),$4) RETURNING author_id',[i.project_id,req.user.user_id,fullName(req.user),safeText(req.user.department,160)]);
    await c.query('INSERT INTO author_details(author_id,contribution,collaborator_type,email,link_status) VALUES($1,$2,$3,$4,$5)',[a[0].author_id,i.contribution,i.collaborator_type,req.user.email,'Linked']);
   }
   await c.query("UPDATE invitations SET status='accepted',accepted_at=now() WHERE invitation_id=$1",[i.invitation_id]);
   await notice(c,i.invited_by,'Invitation accepted',`${fullName(req.user)} joined project ${i.project_id}`);
   await event(c,req.user.user_id,'AUTHOR_INVITE_ACCEPTED','research',i.project_id);
   return i.project_id;
  });
  res.json({accepted:true,projectId:result});
 }));
 app.get('/api/notifications',auth,asyncRoute(async(req,res)=>{
  const {rows}=await query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 150',[req.user.user_id]);
  res.json({notifications:rows.map(n=>({id:String(n.notification_id),title:n.title,text:n.content,read:n.is_read,type:n.kind,time:new Date(n.created_at).toLocaleString('en-PH')}))});
 }));
 app.patch('/api/notifications/:id',auth,asyncRoute(async(req,res)=>{
  if(typeof req.body?.read!=='boolean')bad('read must be a boolean.');
  const {rowCount}=await query('UPDATE notifications SET is_read=$1 WHERE notification_id=$2 AND user_id=$3',[req.body.read,req.params.id,req.user.user_id]);if(!rowCount)bad('Notification not found.',404);res.json({updated:true});
 }));
 app.post('/api/notifications/read-all',auth,asyncRoute(async(req,res)=>{await query('UPDATE notifications SET is_read=true WHERE user_id=$1',[req.user.user_id]);res.json({updated:true})}));

 app.get('/api/reviewers',auth,admin,asyncRoute(async(req,res)=>{
  const {rows}=await query(`SELECT u.user_id,u.first_name||' '||u.last_name AS name,u.email,u.department,c.specialization,(SELECT count(*)::int FROM peer_reviews r WHERE r.reviewer_id=u.user_id AND r.review_status IN ('ASSIGNED','IN_PROGRESS')) AS active FROM users u LEFT JOIN reviewer_certifications c ON c.user_id=u.user_id WHERE u.role IN ('FACULTY','REVIEWER') AND u.active AND u.email_verified ORDER BY name`);
  const limit=Number((await query("SELECT setting_value FROM platform_settings WHERE setting_key='general'")).rows[0]?.setting_value?.maxLoad||5);
  res.json({reviewers:rows.map(r=>({id:String(r.user_id),name:r.name,email:r.email,dept:r.department||'Faculty',specialty:r.specialization||'Not certified',active:r.active,max:limit,avg:'—',score:'—'}))});
 }));
 app.post('/api/reviewers',auth,admin,asyncRoute(async(req,res)=>{
  const email=lowerEmail(req.body.email);const {rows}=await query("SELECT user_id FROM users WHERE email=$1 AND role IN ('FACULTY','REVIEWER') AND active AND email_verified",[email]);
  if(!rows.length)bad('Select an existing verified faculty account.');
  await inTx(async c=>{await c.query('INSERT INTO reviewer_certifications(user_id,specialization,certified_by) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET specialization=EXCLUDED.specialization,certified_by=EXCLUDED.certified_by,certified_at=now()',[rows[0].user_id,safeText(req.body.specialization,1000),req.user.user_id]);await event(c,req.user.user_id,'REVIEWER_CERTIFIED','user',rows[0].user_id)});
  res.status(201).json({certified:true});
 }));
 app.get('/api/settings',auth,admin,asyncRoute(async(req,res)=>res.json({settings:(await query("SELECT setting_value FROM platform_settings WHERE setting_key='general'")).rows[0]?.setting_value||{}})));
 app.patch('/api/settings',auth,admin,asyncRoute(async(req,res)=>{
  const b=req.body||{};const current=(await query("SELECT setting_value FROM platform_settings WHERE setting_key='general'")).rows[0]?.setting_value||{};
  const next={...current,platform:safeText(b.platform??current.platform,120),contact:safeText(b.contact??current.contact,255),strict:typeof b.strict==='boolean'?b.strict:current.strict,threshold:Number.isFinite(Number(b.threshold))?Math.min(100,Math.max(0,Number(b.threshold))):current.threshold,maxLoad:Number.isFinite(Number(b.maxLoad))?Math.max(1,Math.min(100,Math.floor(Number(b.maxLoad)))):current.maxLoad,maintenance:typeof b.maintenance==='boolean'?b.maintenance:current.maintenance};
  await inTx(async c=>{await c.query("INSERT INTO platform_settings(setting_key,setting_value) VALUES('general',$1) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=now()",[JSON.stringify(next)]);await event(c,req.user.user_id,'SETTINGS_UPDATED','settings','general')});
  res.json({settings:next});
 }));

 // Scan already-uploaded manuscript PDFs/DOCX against other KnowVa manuscripts only.
 app.get('/api/projects/:id/validation',auth,asyncRoute(async(req,res)=>{
  const {id,permission}=await loadProject(req);
  if(!permission.admin&&!permission.owner)bad('Only the lead researcher or administrator can see validation results.',403);
  const {rows}=await query('SELECT check_id,overlap_percent,compared_count,skipped_count,matches,ai_feedback,methodology,created_at FROM manuscript_checks WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1',[id]);
  const r=rows[0];if(!r)return res.json({report:null});
  res.json({report:{id:r.check_id,overlapPercent:r.overlap_percent===null?null:Number(r.overlap_percent),compared:r.compared_count,skipped:r.skipped_count,matches:permission.admin?r.matches:[],aiFeedback:r.ai_feedback,method:r.methodology,createdAt:r.created_at}});
 }));
 app.post('/api/projects/:id/validation/run',auth,throttle,asyncRoute(async(req,res)=>{
  const {id,permission}=await loadProject(req);
  if(!permission.admin&&!permission.owner)bad('Only the lead researcher or administrator can request this check.',403);
  const ai=req.body?.aiReview===true;
  if(ai&&req.body?.externalConsent!==true)bad('Consent is required before sending an excerpt to Groq.',400);
  const result=await scanInternalCorpus(id);
  const aiFeedback=ai?await openAiWritingReview(result.fileId):null;
  const {rows}=await query(`INSERT INTO manuscript_checks(project_id,file_id,checked_by,overlap_percent,compared_count,skipped_count,matches,ai_feedback,methodology)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING check_id,created_at`,[id,result.fileId,req.user.user_id,result.score,result.compared,result.skipped,JSON.stringify(result.matches),aiFeedback,result.method]);
  await inTx(c=>event(c,req.user.user_id,'MANUSCRIPT_INTERNAL_CHECK','research',id,{checkId:rows[0].check_id,comparisonCount:result.compared,aiReview:ai},req.ip));
  res.json({report:{id:rows[0].check_id,createdAt:rows[0].created_at,overlapPercent:result.score,compared:result.compared,skipped:result.skipped,unindexed:result.unindexed,matches:permission.admin?result.matches:[],aiFeedback,method:result.method,note:result.note}});
 }));
 app.get('/api/admin/security',auth,admin,asyncRoute(async(req,res)=>res.json(await loadSecurityOverview())));
 app.get('/api/mentorship/meetings',auth,faculty,asyncRoute(async(req,res)=>{
  const {rows}=await query('SELECT meeting_id,title,scheduled_at FROM mentorship_meetings WHERE faculty_id=$1 OR $2::boolean ORDER BY scheduled_at DESC LIMIT 200',[req.user.user_id,req.user.role==='ADMIN']);
  res.json({meetings:rows.map(m=>({id:m.meeting_id,title:m.title,scheduledAt:m.scheduled_at}))});
 }));
 app.post('/api/mentorship/meetings',auth,faculty,asyncRoute(async(req,res)=>{
  const title=safeText(req.body?.title,255),when=new Date(req.body?.scheduledAt);
  if(!title||Number.isNaN(+when)||when<Date.now())bad('Provide a title and a future date/time.');
  const {rows}=await query('INSERT INTO mentorship_meetings(faculty_id,title,scheduled_at) VALUES($1,$2,$3) RETURNING *',[req.user.user_id,title,when]);
  res.status(201).json({meeting:{id:rows[0].meeting_id,title,scheduledAt:rows[0].scheduled_at}});
 }));
 app.get('/api/audit',auth,admin,asyncRoute(async(req,res)=>{
  const {rows}=await query('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 500');
  res.json({items:rows.map(a=>({time:new Date(a.created_at).toLocaleString('en-PH'),severity:'INFO',source:a.event_type,action:`${a.entity_type||'system'} ${a.entity_id||''}`,ip:a.ip_address||'—',status:'SUCCESS',id:String(a.audit_id)}))});
 }));
 app.get('/api/admin/health',auth,admin,asyncRoute(async(req,res)=>{
  const [projects,users,uploads,publications]=await Promise.all([query('SELECT count(*)::int AS count FROM research_projects'),query('SELECT count(*)::int AS count FROM users WHERE active'),query('SELECT count(*)::int AS count,coalesce(sum(size_bytes),0) AS bytes FROM uploaded_files'),query("SELECT count(*)::int AS count FROM publication_records WHERE publication_status='PUBLISHED'")]);
  res.json({database:'connected',projects:projects.rows[0].count,activeUsers:users.rows[0].count,uploadedFiles:uploads.rows[0].count,bytesStored:Number(uploads.rows[0].bytes),publishedRecords:publications.rows[0].count,uptimeSeconds:Math.round(process.uptime())});
 }));
 // Authenticated configuration status does not make a paid provider request.
 app.get('/api/ai/status',auth,asyncRoute(async(req,res)=>res.json({...await groqUsage(),note:'Configured means a key is present, not that Groq has accepted it.'})));
 // Administrator-only, explicitly requested small API test; may incur minimal token charges.
 app.post('/api/ai/test',auth,admin,throttle,asyncRoute(async(req,res)=>res.json(await testOpenAIConnection())));
 app.post('/api/ai/extract',auth,throttle,upload.single('file'),asyncRoute(async(req,res)=>{
  if(!req.file)bad('Upload a PDF or DOCX research file.');
  const sendToAi=req.body?.sendToAi==='true';
  if(sendToAi&&req.body?.externalConsent!=='yes')bad('Explicit permission is required before sending document text to Groq.');
  const result=await parseConcept(req.file.buffer,req.file.originalname,sendToAi);
  res.json(result);
 }));
}

async function replaceAuthors(c,projectId,authors,user){
 if(!Array.isArray(authors))bad('Invalid authors.');
 if(authors.length>30)bad('Maximum 30 co-authors per research.');
 // The lead is kept and is never replaced by a client supplied author identity.
 const lead=(await c.query('SELECT p.lead_researcher_id,u.email FROM research_projects p JOIN users u ON u.user_id=p.lead_researcher_id WHERE p.project_id=$1',[projectId])).rows[0];
 if(!lead)bad('Research not found.',404);
 await c.query('DELETE FROM project_authors WHERE project_id=$1 AND user_id IS DISTINCT FROM $2',[projectId,lead.lead_researcher_id]);
 let order=2;
 for(const a of authors){
  const email=lowerEmail(a?.email),name=safeText(a?.name,250),contribution=safeText(a?.role,100)||'Co-Author';
  if(!name||email===lowerEmail(lead.email)||Number(a?.userId)===lead.lead_researcher_id)continue;
  let uid=null;
  if(a.userId||email){
   const {rows}=await c.query('SELECT user_id,email,first_name,last_name FROM users WHERE email=$1 AND active AND email_verified',[email]);
   if(rows.length){
    if(a.userId&&Number(a.userId)!==rows[0].user_id)bad('Author account does not match the provided email.');
    if(rows[0].user_id===lead.lead_researcher_id)continue;
    uid=rows[0].user_id;
   }else if(a.userId)bad('Author account is not verified.');
  }
  if(a.linkStatus==='Pending invitation'&&!uid)continue;
  const {rows:r}=await c.query('INSERT INTO project_authors(project_id,user_id,author_name,author_order,is_corresponding,affiliation) VALUES($1,$2,$3,$4,false,$5) RETURNING author_id',[projectId,uid,name,order++,safeText(a.affiliation,255)||null]);
  await c.query('INSERT INTO author_details(author_id,contribution,collaborator_type,email,link_status) VALUES($1,$2,$3,$4,$5)',[r[0].author_id,contribution,safeText(a.type,40)||'Internal',email||null,uid?'Linked':'Unlinked']);
 }
}
