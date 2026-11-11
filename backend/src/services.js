import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import nodemailer from 'nodemailer';
import pg from 'pg';

export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL, max:12, idleTimeoutMillis:30000, connectionTimeoutMillis:8000});
export const query = (sql,params=[]) => pool.query(sql,params);
export const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const emailValid = email => /^[^\s@]+@iskolarngbayan\.pup\.edu\.ph$/i.test(String(email||''));
export const lowerEmail = email => String(email||'').trim().toLowerCase();
export const safeText = (x,max=5000) => typeof x==='string' ? x.trim().slice(0,max) : '';
export const publicUser = u => ({id:String(u.user_id),name:[u.first_name,u.last_name].filter(Boolean).join(' ').trim(),email:u.email,role:({STUDENT:'student',FACULTY:'faculty',ADMIN:'admin',REVIEWER:'faculty'})[u.role]||'student',avatarUrl:u.avatar_url||null,department:u.department||'',universityId:u.student_number||'',active:u.active!==false,createdAt:u.created_at||null});
export const directoryUser = u => ({...publicUser(u),id:String(u.user_id),universityId:u.student_number||''});
export const userRow = async id => (await query('SELECT * FROM users WHERE user_id=$1',[id])).rows[0];
export const fullName = u => `${u.first_name} ${u.last_name}`.trim();
export async function inTx(callback) {
 const client=await pool.connect();
 try {await client.query('BEGIN');const value=await callback(client);await client.query('COMMIT');return value}
 catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
export async function event(client, actor, eventType, entityType, entityId, meta={}, ip=null){
 const address=typeof ip==='string' && /^[\d.a-f:]+$/i.test(ip.replace(/^::ffff:/,'')) ? ip : null;
 await client.query('INSERT INTO audit_events(actor_id,event_type,entity_type,entity_id,metadata,ip_address) VALUES($1,$2,$3,$4,$5,$6)',[actor||null,eventType,entityType||null,String(entityId??''),JSON.stringify(meta),address]);
}
export async function notice(client,uid,title,content,kind='system') {
 if(uid)await client.query('INSERT INTO notifications(user_id,title,content,kind) VALUES($1,$2,$3,$4)',[uid,title,content,kind]);
}
export const displayStatus = value => ({DRAFT:'Draft',SUBMITTED:'Submitted',SCREENING:'Screening',APPLICATION_APPROVED:'Application Approved',UNDER_REVIEW:'Under Review',REVISION_REQUESTED:'Revision Required',APPROVED:'Approved',REJECTED:'Rejected',PUBLISHED:'Published',SUBMITTED_TO_CONFERENCE:'Submitted to Conference'})[value]||'Draft';
export const dbStatus = value => ({'Draft':'DRAFT','Submitted':'SUBMITTED','Screening':'SCREENING','Application Approved':'APPLICATION_APPROVED','Under Review':'UNDER_REVIEW','Validation Pending':'APPLICATION_APPROVED','Revision Required':'REVISION_REQUESTED','Approved':'APPROVED','Rejected':'REJECTED','Published':'PUBLISHED','Submitted to Conference':'SUBMITTED_TO_CONFERENCE'})[value];
export const defaultStage = v=>({DRAFT:'Draft',SUBMITTED:'Initial Screening',SCREENING:'Screening',APPLICATION_APPROVED:'Journal Record',UNDER_REVIEW:'Manuscript Review',REVISION_REQUESTED:'Revision',APPROVED:'Conference Preparation',REJECTED:'Rejected',PUBLISHED:'Published',SUBMITTED_TO_CONFERENCE:'Submitted to Conference'})[v]||'Draft';

export async function permissions(user, projectId,client=pool){
 const {rows} = await client.query(`SELECT p.project_id, p.lead_researcher_id, p.status::text AS status,
 (p.lead_researcher_id=$2) AS owner,
 EXISTS(SELECT 1 FROM project_authors a WHERE a.project_id=p.project_id AND a.user_id=$2) AS author,
 EXISTS(SELECT 1 FROM project_details d WHERE d.project_id=p.project_id AND d.advisor_id=$2) AS adviser,
 EXISTS(SELECT 1 FROM peer_reviews r JOIN manuscripts m USING(manuscript_id) WHERE m.project_id=p.project_id AND r.reviewer_id=$2) AS reviewer
 FROM research_projects p WHERE p.project_id=$1`,[projectId,user.user_id]);
 if(!rows.length)return null;
 const r=rows[0],admin=user.role==='ADMIN';
 return {...r,admin,read:admin||r.owner||r.author||r.adviser||r.reviewer,write:admin||r.owner};
}

export async function listProjects(user,client=pool){
 const admin=user.role==='ADMIN';
 const {rows}=await client.query(`SELECT p.*,d.research_type,d.category,d.department AS research_department,d.objectives,d.advisor_id,d.stage,d.resume_stage,d.sections,
 lead.first_name||' '||lead.last_name AS lead_name,lead.email AS owner_email,adv.email AS advisor_email,
 (SELECT u.first_name||' '||u.last_name FROM peer_reviews r JOIN manuscripts m ON m.manuscript_id=r.manuscript_id JOIN users u ON u.user_id=r.reviewer_id WHERE m.project_id=p.project_id ORDER BY r.review_id DESC LIMIT 1) AS reviewer_name
 FROM research_projects p
 JOIN users lead ON lead.user_id=p.lead_researcher_id
 LEFT JOIN project_details d ON d.project_id=p.project_id
 LEFT JOIN users adv ON adv.user_id=d.advisor_id
 WHERE $2::boolean OR p.lead_researcher_id=$1
 OR EXISTS (SELECT 1 FROM project_authors pa WHERE pa.project_id=p.project_id AND pa.user_id=$1)
 OR EXISTS (SELECT 1 FROM project_details dd WHERE dd.project_id=p.project_id AND dd.advisor_id=$1)
 OR EXISTS (SELECT 1 FROM peer_reviews r JOIN manuscripts m USING(manuscript_id) WHERE m.project_id=p.project_id AND r.reviewer_id=$1)
 ORDER BY p.created_at DESC LIMIT 500`,[user.user_id,admin]);
 if(!rows.length)return [];
 const ids=rows.map(x=>x.project_id);
 const [authorRows,fileRows,historyRows,uploadedRows,publicationRows] = await Promise.all([
 client.query(`SELECT a.*,d.contribution,d.collaborator_type,d.email AS author_email,d.link_status,u.email AS registered_email FROM project_authors a LEFT JOIN author_details d ON d.author_id=a.author_id LEFT JOIN users u ON u.user_id=a.user_id WHERE a.project_id=ANY($1::int[]) ORDER BY a.project_id,a.author_order`,[ids]),
 client.query(`SELECT manuscript_id,project_id,version_number,file_url,uploaded_at FROM manuscripts WHERE project_id=ANY($1::int[]) ORDER BY version_number DESC`,[ids]),
 client.query(`SELECT h.project_id,h.created_at,h.action_taken,h.stage_name,u.first_name||' '||u.last_name AS actor FROM workflow_history h LEFT JOIN users u ON u.user_id=h.action_by_user_id WHERE h.project_id=ANY($1::int[]) ORDER BY h.created_at ASC`,[ids]),
 client.query(`SELECT project_id,file_id,file_name,size_bytes,mime_type,purpose FROM uploaded_files WHERE project_id=ANY($1::int[]) ORDER BY uploaded_at ASC`,[ids]),
 client.query(`SELECT publication_id,project_id,publication_type,venue_name,submission_date,publication_date,publication_status,doi_or_link FROM publication_records WHERE project_id=ANY($1::int[]) ORDER BY publication_id DESC`,[ids])
 ]);
 const map= (arr,key)=>{const m=new Map();for(const r of arr){const k=r[key];if(!m.has(k))m.set(k,[]);m.get(k).push(r)}return m};
 const authors=map(authorRows.rows,'project_id'), files=map(fileRows.rows,'project_id'),hist=map(historyRows.rows,'project_id'),uploads=map(uploadedRows.rows,'project_id'),publications=map(publicationRows.rows,'project_id');
 return rows.map(r=>({
 id:`RES-${new Date(r.created_at).getFullYear()}-${String(r.project_id).padStart(4,'0')}`,databaseId:r.project_id,title:r.title,abstract:r.abstract||'',keywords:r.keywords||'',type:r.research_type||'Unspecified',category:r.category||'Uncategorized',department:r.research_department||'Computer Engineering',objectives:r.objectives||'',advisorEmail:r.advisor_email||'',ownerEmail:r.owner_email,lead:r.lead_name,reviewer:r.reviewer_name||'',status:displayStatus(r.status),stage:r.stage||defaultStage(r.status),resumeStage:r.resume_stage||'',date:new Date(r.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),sections:r.sections||{},
 authors:(authors.get(r.project_id)||[]).map(a=>({name:a.author_name,email:a.registered_email||a.author_email||'',userId:a.user_id?String(a.user_id):null,role:a.contribution|| (a.is_corresponding?'Lead Author':'Co-Author'),type:a.collaborator_type||'Internal',linkStatus:a.link_status|| (a.user_id?'Linked':'Unlinked')})),
 files:[...(uploads.get(r.project_id)||[]).map(f=>({id:f.file_id,name:f.file_name,size:Number(f.size_bytes),purpose:f.purpose,url:`/api/projects/${r.project_id}/files/${f.file_id}`})),...(files.get(r.project_id)||[]).filter(f=>!String(f.file_url).startsWith('/api/')).map(f=>({name:String(f.file_url).split('/').pop(),size:0,placeholder:true}))],
 publicationRecords:(publications.get(r.project_id)||[]).map(v=>({id:v.publication_id,kind:v.publication_type,venue:v.venue_name||'',status:v.publication_status,doi:v.doi_or_link||'',submissionDate:v.submission_date,publicationDate:v.publication_date})),
 history:(hist.get(r.project_id)||[]).map(h=>({event:h.action_taken,time:new Date(h.created_at).toLocaleString('en-PH'),actor:h.actor||'System',stage:h.stage_name}))
 }));
}
export const parseProjectId = raw => {const s=String(raw||'');const m=/^RES-\d{4}-(\d+)$/.exec(s);if(m)return Number(m[1]);if(/^\d+$/.test(s))return Number(s);return null};

let smtp;
export async function sendEmail(to,subject,html){
 if(!process.env.SMTP_HOST||!process.env.SMTP_FROM){
  if(process.env.NODE_ENV!=='production') console.log(`[DEV EMAIL NOT SENT] Recipient: ${to} | ${subject} | ${html.replace(/<[^>]+>/g,' ').slice(0,900)}`);
  return false;
 }
 if(!smtp)smtp=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT)===465,auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined});
 await smtp.sendMail({to,from:process.env.SMTP_FROM,subject,text:html.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&'),html});return true;
}
export const escapeHtml = s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

// Admin-editable templates are stored in PostgreSQL; secrets and action links are never stored in the templates.
export async function composeEmail(key,variables={},fallbackSubject='',fallbackBody='',action=null){
 let template;
 try{template=(await query('SELECT subject,body FROM platform_email_templates WHERE template_key=$1',[key])).rows[0]}catch(e){if(e?.code!=='42P01')throw e}
 const interpolate=text=>String(text||'').replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g,(_,name)=>String(variables[name]??''));
 const subject=interpolate(template?.subject||fallbackSubject).replace(/[\r\n]/g,' ').slice(0,255);
 const content=escapeHtml(interpolate(template?.body||fallbackBody)).replace(/\r?\n/g,'<br>');
 const link=action?.url?`<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label||'Open KnowVa')}</a></p>`:'';
 return {subject,html:`<p>${content}</p>${link}`};
}

export const appUrl = path => `${(process.env.PUBLIC_APP_URL||'http://localhost:5173').replace(/\/$/,'')}${path}`;
export const storageDir=path.resolve('storage');
export const safeFileName=x=>String(x||'document').replace(/[\x00-\x1f/\\]/g,'_').slice(0,150);
export async function saveBytes(buffer, ext){await fs.mkdir(storageDir,{recursive:true,mode:0o700});const name=`${crypto.randomUUID()}${ext}`;await fs.writeFile(path.join(storageDir,name),buffer,{flag:'wx',mode:0o600});return name}
export const removeStored=async name=>{if(!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(name))return;await fs.unlink(path.join(storageDir,name)).catch(()=>{})};
