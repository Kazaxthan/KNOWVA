import bcrypt from 'bcryptjs';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import {query,inTx,event,notice,publicUser,permissions,parseProjectId,safeText,saveBytes,removeStored,storageDir} from './services.js';

const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const fail=(msg,status=400)=>{throw Object.assign(new Error(msg),{statusCode:status})};
const signed=(req,res,next)=>req.user?next():res.status(401).json({message:'Please sign in.'});
const administrator=(req,res,next)=>req.user?.role==='ADMIN'?next():res.status(403).json({message:'Administrator access required.'});
const idOf=raw=>{const id=parseProjectId(raw);if(!id)fail('Invalid project ID.');return id};
const canRead=async(req,id,write=false)=>{const p=await permissions(req.user,id);if(!p)fail('Research not found.',404);if(!(write?p.write:p.read))fail('You do not have permission to access this research.',403);return p};
const ref=(id,createdAt)=>`RES-${new Date(createdAt).getFullYear()}-${String(id).padStart(4,'0')}`;
const pubStatus=['PREPARING','SUBMITTED','ACCEPTED','PUBLISHED','REJECTED'];
const pubType=['JOURNAL','CONFERENCE','OTHER'];
const present=r=>({id:r.publication_id,projectId:r.project_id,kind:r.publication_type,venue:r.venue_name||'',status:r.publication_status,doi:r.doi_or_link||'',submissionDate:r.submission_date,publicationDate:r.publication_date,createdAt:r.created_at||null});
const positiveInt=x=>/^\d+$/.test(String(x||''))&&Number(x)>0;

const logoUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1}});
export function registerFullApp(app){
 app.get('/api/branding',wrap(async(req,res)=>{
  const row=(await query("SELECT setting_value FROM platform_settings WHERE setting_key='general'")).rows[0];
  const s=row?.setting_value||{};res.json({platform:s.platform||'KNOWVA',logoUrl:s.logoUrl||null});
 }));
 app.get('/api/branding/logo/:file',wrap(async(req,res)=>{
  const file=String(req.params.file||'');if(!/^[a-f0-9-]{36}\.jpg$/i.test(file))fail('Not found.',404);
  const s=(await query("SELECT setting_value FROM platform_settings WHERE setting_key='general'")).rows[0]?.setting_value||{};
  if(s.logoUrl!==`/api/branding/logo/${file}`)fail('Not found.',404);
  res.type('image/jpeg').set('Cache-Control','public,max-age=300').sendFile(path.join(storageDir,file));
 }));
 app.post('/api/admin/logo',signed,administrator,logoUpload.single('logo'),wrap(async(req,res)=>{
  if(!req.file)fail('Choose a JPG, PNG or WebP image.');
  if(!['image/jpeg','image/png','image/webp'].includes(req.file.mimetype))fail('Unsupported image type.');
  let image;try{image=await sharp(req.file.buffer,{limitInputPixels:12e6}).rotate().resize(512,512,{fit:'contain',background:'#ffffff'}).jpeg({quality:85}).toBuffer()}catch{fail('Image could not be processed.')}
  const diskName=await saveBytes(image,'.jpg'),url=`/api/branding/logo/${diskName}`;
  let old;
  try{await inTx(async c=>{const row=(await c.query("SELECT setting_value FROM platform_settings WHERE setting_key='general' FOR UPDATE")).rows[0]?.setting_value||{};old=row.logoUrl;
   await c.query("INSERT INTO platform_settings(setting_key,setting_value) VALUES('general',$1) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=now()",[JSON.stringify({...row,logoUrl:url})]);
   await event(c,req.user.user_id,'PLATFORM_LOGO_UPDATED','settings','general',{},req.ip);
  })}catch(e){await removeStored(diskName);throw e}
  if(old?.startsWith('/api/branding/logo/'))await removeStored(path.basename(old));
  res.json({logoUrl:url});
 }));
 app.delete('/api/admin/logo',signed,administrator,wrap(async(req,res)=>{
  let old;await inTx(async c=>{const row=(await c.query("SELECT setting_value FROM platform_settings WHERE setting_key='general' FOR UPDATE")).rows[0]?.setting_value||{};old=row.logoUrl;
   delete row.logoUrl;await c.query("UPDATE platform_settings SET setting_value=$1,updated_at=now() WHERE setting_key='general'",[JSON.stringify(row)]);
   await event(c,req.user.user_id,'PLATFORM_LOGO_REMOVED','settings','general',{},req.ip);
  });
  if(old?.startsWith('/api/branding/logo/'))await removeStored(path.basename(old));res.json({logoUrl:null});
 }));
 // Password updates always require the current password; no arbitrary password-change endpoint for other users.
 app.post('/api/account/password',signed,wrap(async(req,res)=>{
  const current=String(req.body?.currentPassword||''), next=String(req.body?.newPassword||'');
  if(!current||next.length<12||next.length>128||!/[A-Z]/.test(next)||!/[a-z]/.test(next)||!/[0-9]/.test(next))fail('Use your current password and a new 12+ character password with uppercase, lowercase, and a number.');
  if(!(await bcrypt.compare(current,req.user.password_hash)))fail('Current password is incorrect.',403);
  if(current===next)fail('Choose a different password.');
  const hash=await bcrypt.hash(next,12);
  await inTx(async c=>{await c.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE user_id=$2',[hash,req.user.user_id]);await event(c,req.user.user_id,'PASSWORD_CHANGED','user',req.user.user_id,{},req.ip)});
  res.json({updated:true,message:'Password updated. Use your new password at your next sign-in.'});
 }));

 app.get('/api/tasks',signed,wrap(async(req,res)=>{
  const {rows}=await query('SELECT task_id,title,completed,created_at FROM user_tasks WHERE user_id=$1 ORDER BY completed,created_at DESC LIMIT 150',[req.user.user_id]);
  res.json({tasks:rows.map(x=>({id:String(x.task_id),title:x.title,completed:x.completed,createdAt:x.created_at}))});
 }));
 app.post('/api/tasks',signed,wrap(async(req,res)=>{
  const title=safeText(req.body?.title,500);if(title.length<3)fail('Task title must have at least three characters.');
  const {rows}=await query('INSERT INTO user_tasks(user_id,title) VALUES($1,$2) RETURNING task_id,title,completed,created_at',[req.user.user_id,title]);
  res.status(201).json({task:{id:String(rows[0].task_id),title:rows[0].title,completed:rows[0].completed,createdAt:rows[0].created_at}});
 }));
 app.patch('/api/tasks/:id',signed,wrap(async(req,res)=>{
  if(!positiveInt(req.params.id))fail('Invalid task ID.');
  if(typeof req.body?.completed!=='boolean')fail('completed must be true or false.');
  const {rows}=await query('UPDATE user_tasks SET completed=$1,updated_at=now() WHERE task_id=$2 AND user_id=$3 RETURNING task_id,title,completed',[req.body.completed,req.params.id,req.user.user_id]);
  if(!rows.length)fail('Task not found.',404);
  res.json({task:{id:String(rows[0].task_id),title:rows[0].title,completed:rows[0].completed}});
 }));
 app.delete('/api/tasks/:id',signed,wrap(async(req,res)=>{
  if(!positiveInt(req.params.id))fail('Invalid task ID.');
  const result=await query('DELETE FROM user_tasks WHERE task_id=$1 AND user_id=$2',[req.params.id,req.user.user_id]);if(!result.rowCount)fail('Task not found.',404);res.status(204).end();
 }));

 app.get('/api/activity',signed,wrap(async(req,res)=>{
  const {rows}=await query(`SELECT h.history_id,p.title,p.project_id,p.created_at AS project_created,h.action_taken,h.stage_name,h.created_at,u.first_name||' '||u.last_name AS actor
   FROM workflow_history h JOIN research_projects p ON p.project_id=h.project_id LEFT JOIN users u ON u.user_id=h.action_by_user_id
   WHERE $2::boolean OR p.lead_researcher_id=$1 OR EXISTS(SELECT 1 FROM project_authors pa WHERE pa.project_id=p.project_id AND pa.user_id=$1)
   OR EXISTS(SELECT 1 FROM project_details d WHERE d.project_id=p.project_id AND d.advisor_id=$1)
   OR EXISTS(SELECT 1 FROM peer_reviews r JOIN manuscripts m USING(manuscript_id) WHERE m.project_id=p.project_id AND r.reviewer_id=$1)
   ORDER BY h.created_at DESC LIMIT 80`,[req.user.user_id,req.user.role==='ADMIN']);
  res.json({items:rows.map(x=>({id:x.history_id,title:x.title,projectId:ref(x.project_id,x.project_created),action:x.action_taken,stage:x.stage_name,time:x.created_at,actor:x.actor||'System'}))});
 }));

 app.get('/api/insights',signed,wrap(async(req,res)=>{
  const uid=req.user.user_id,admin=req.user.role==='ADMIN';
  const projects=await query(`SELECT date_trunc('month',p.created_at)::date AS month,count(*)::int AS count
   FROM research_projects p WHERE $2::boolean OR p.lead_researcher_id=$1 OR EXISTS(SELECT 1 FROM project_authors a WHERE a.project_id=p.project_id AND a.user_id=$1)
   GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,[uid,admin]);
  const [status,departments,users,reviews,published]=await Promise.all([
   query(`SELECT status::text AS status,count(*)::int AS count FROM research_projects p WHERE $2::boolean OR p.lead_researcher_id=$1 GROUP BY 1`,[uid,admin]),
   query(`SELECT coalesce(nullif(d.department,''),'Unspecified') AS department,count(*)::int AS count FROM research_projects p LEFT JOIN project_details d USING(project_id) WHERE $2::boolean OR p.lead_researcher_id=$1 GROUP BY 1 ORDER BY 2 DESC`,[uid,admin]),
   query("SELECT role::text,count(*)::int AS count FROM users WHERE active=true GROUP BY role"),
   query("SELECT count(*)::int AS count FROM peer_reviews WHERE review_status IN ('ASSIGNED','IN_PROGRESS')"),
   query("SELECT count(*)::int AS count FROM publication_records WHERE publication_status='PUBLISHED'")
  ]);
  res.json({monthly:projects.rows.reverse().map(r=>({month:r.month,total:r.count})),statuses:status.rows,departments:departments.rows,activeUsersByRole:Object.fromEntries(users.rows.map(r=>[r.role,r.count])),activeReviews:reviews.rows[0].count,publishedRecords:published.rows[0].count,source:'PostgreSQL'});
 }));

 app.get('/api/projects/:id/publications',signed,wrap(async(req,res)=>{
  const id=idOf(req.params.id);await canRead(req,id);
  const {rows}=await query('SELECT * FROM publication_records WHERE project_id=$1 ORDER BY publication_id DESC',[id]);
  res.json({records:rows.map(present)});
 }));
 app.post('/api/projects/:id/publications',signed,wrap(async(req,res)=>{
  const id=idOf(req.params.id),permission=await canRead(req,id,true),data=req.body||{};
  const kind=String(data.kind||'JOURNAL').toUpperCase(),status=String(data.status||'PREPARING').toUpperCase();
  if(!pubType.includes(kind)||!pubStatus.includes(status))fail('Unsupported publication type or status.');
  const venue=safeText(data.venue,255);if(venue.length<3)fail('Enter a journal or conference name.');
  if(!permission.admin&&!(permission.owner&&permission.status==='APPLICATION_APPROVED'&&status==='PREPARING'&&kind==='JOURNAL'))fail('Publication workflow change requires administrator approval.',403);
  if(status==='PUBLISHED'&&!permission.admin)fail('Only an administrator can confirm a published record.',403);
  const result=await inTx(async c=>{
   const p=(await c.query('SELECT * FROM research_projects WHERE project_id=$1 FOR UPDATE',[id])).rows[0];if(!p)fail('Project not found.',404);
   const manuscript=(await c.query('SELECT manuscript_id FROM manuscripts WHERE project_id=$1 ORDER BY version_number DESC LIMIT 1',[id])).rows[0];
   const {rows}=await c.query(`INSERT INTO publication_records(project_id,manuscript_id,publication_type,venue_name,submission_date,publication_date,publication_status,doi_or_link)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[id,manuscript?.manuscript_id||null,kind,venue,data.submissionDate||null,data.publicationDate||null,status,safeText(data.doi,500)||null]);
   if(status==='PUBLISHED'){
    if(!['APPROVED','SUBMITTED_TO_CONFERENCE','PUBLISHED'].includes(p.status))fail('Publication must first be approved or submitted to a conference.',409);
    await c.query("UPDATE research_projects SET status='PUBLISHED',updated_at=now() WHERE project_id=$1",[id]);
    await c.query("UPDATE project_details SET stage='Published' WHERE project_id=$1",[id]);
   }else if(status==='SUBMITTED'&&p.status==='APPROVED'){
    await c.query("UPDATE research_projects SET status='SUBMITTED_TO_CONFERENCE',updated_at=now() WHERE project_id=$1",[id]);
    await c.query("UPDATE project_details SET stage='Submitted to Conference' WHERE project_id=$1",[id]);
   }else if(kind==='JOURNAL'&&status==='PREPARING'&&p.status==='APPLICATION_APPROVED'){
    await c.query("UPDATE project_details SET stage='Authorship Review' WHERE project_id=$1",[id]);
   }
   await c.query('INSERT INTO workflow_history(project_id,action_by_user_id,stage_name,action_taken) VALUES($1,$2,$3,$4)',[id,req.user.user_id,'Publication',`Publication ${kind.toLowerCase()} record: ${status.toLowerCase()}`]);
   await event(c,req.user.user_id,'PUBLICATION_RECORDED','research',id,{publicationId:rows[0].publication_id,status},req.ip);
   if(p.lead_researcher_id!==req.user.user_id)await notice(c,p.lead_researcher_id,'Publication updated',`${p.title}: ${status.toLowerCase()}`);
   return rows[0];
  });
  res.status(201).json({record:present(result)});
 }));

 app.get('/api/admin/export',signed,administrator,wrap(async(req,res)=>{
  const [users,projects,authors,files,pubs,reviews,settings]=await Promise.all([
   query('SELECT user_id,first_name,last_name,email,role::text,department,student_number,active,email_verified,created_at FROM users'),
   query('SELECT * FROM research_projects'),query('SELECT * FROM project_authors'),
   query('SELECT file_id,project_id,file_name,mime_type,size_bytes,purpose,uploaded_at FROM uploaded_files'),
   query('SELECT * FROM publication_records'),query('SELECT * FROM peer_reviews'),query('SELECT * FROM platform_settings')]);
  await inTx(c=>event(c,req.user.user_id,'ADMIN_EXPORT','database','research_export',{},req.ip));
  res.set('Cache-Control','no-store').json({exportedAt:new Date().toISOString(),warning:'Metadata export only. Password hashes, file contents, and session tokens are excluded.',users:users.rows,projects:projects.rows,authors:authors.rows,uploadedFileMetadata:files.rows,publications:pubs.rows,reviews:reviews.rows,settings:settings.rows});
 }));

 app.get('/api/admin/email-templates',signed,administrator,wrap(async(req,res)=>{
  const {rows}=await query('SELECT template_key,subject,body,updated_at FROM platform_email_templates ORDER BY template_key');res.json({templates:rows});
 }));
 app.patch('/api/admin/email-templates/:key',signed,administrator,wrap(async(req,res)=>{
  const key=String(req.params.key||'');if(!['verification','invitation','review'].includes(key))fail('Unknown email template.');
  const subject=safeText(req.body?.subject,255),body=safeText(req.body?.body,5000);
  if(!subject||!body)fail('Subject and message are required.');
  const {rows}=await query('UPDATE platform_email_templates SET subject=$1,body=$2,updated_by=$3,updated_at=now() WHERE template_key=$4 RETURNING template_key,subject,body',[subject,body,req.user.user_id,key]);
  res.json({template:rows[0],note:'Template stored. Automated email delivery still requires configured SMTP credentials.'});
 }));
}
