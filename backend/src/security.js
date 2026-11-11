import {query} from './services.js';
const allowedTypes=new Set(['LOGIN_FAILED','LOGIN_BLOCKED','ACCESS_DENIED','CSRF_REJECTED','RATE_LIMITED','SERVER_ERROR']);
export async function securityEvent(req,type,severity='WARNING'){
 if(!allowedTypes.has(type))return;
 const ip=String(req.ip||'').replace(/^::ffff:/,'');
 try{await query('INSERT INTO security_events(event_type,severity,actor_id,source_ip) VALUES($1,$2,$3,$4)',[type,severity,req.user?.user_id||null,ip||null]);}
 catch(e){console.error('[KnowVa security monitoring unavailable]',e.message)}
}
export async function loadSecurityOverview(){
 const [summary,recent,alerts]=await Promise.all([
  query(`SELECT event_type,count(*)::int AS count FROM security_events WHERE created_at>now()-interval '24 hours' GROUP BY event_type ORDER BY count DESC`),
  query('SELECT event_id,event_type,severity,actor_id,source_ip,created_at FROM security_events ORDER BY created_at DESC LIMIT 100'),
  query(`SELECT event_type,source_ip,count(*)::int AS count FROM security_events WHERE created_at>now()-interval '15 minutes'
    AND event_type IN ('LOGIN_FAILED','RATE_LIMITED','SERVER_ERROR','CSRF_REJECTED') GROUP BY event_type,source_ip
    HAVING count(*)>=CASE WHEN event_type='LOGIN_FAILED' THEN 5 WHEN event_type='CSRF_REJECTED' THEN 5 WHEN event_type='RATE_LIMITED' THEN 2 ELSE 1 END
    ORDER BY count DESC LIMIT 30`)
 ]);
 const counts=Object.fromEntries(summary.rows.map(x=>[x.event_type,x.count]));
 return {windowHours:24,alertWindowMinutes:15,alerts:alerts.rows.map(x=>({type:x.event_type,count:x.count,sourceIp:x.source_ip||'Unknown',severity:x.event_type==='SERVER_ERROR'?'CRITICAL':'WARNING'})),total:summary.rows.reduce((n,x)=>n+x.count,0),counts,events:recent.rows.map(e=>({id:e.event_id,time:new Date(e.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'}),severity:e.severity,source:e.event_type,action:e.actor_id?'User #'+e.actor_id:'Unauthenticated request',ip:e.source_ip||'—',status:'BLOCKED'})),limitations:'Counts only events observed by this API. Not a malware scan, intrusion detection service or guarantee of safety.'};
}
