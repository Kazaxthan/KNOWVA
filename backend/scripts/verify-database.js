import 'dotenv/config';
import pg from 'pg';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is missing in backend/.env');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
try{
 await client.connect();
 const target=await client.query('SELECT current_database() AS db,current_user AS account,version() AS version');
 const tables=['users','research_projects','project_details','manuscripts','uploaded_files','peer_reviews','publication_records','notifications','manuscript_checks','security_events','user_tasks','platform_email_templates','session'];
 const missing=[];
 for(const t of tables){const r=await client.query('SELECT to_regclass($1) AS table_name',[`public.${t}`]);if(!r.rows[0].table_name)missing.push(t)}
 const result=await client.query('SELECT count(*)::int AS count FROM users');
 console.log('Database:',target.rows[0].db);
 console.log('Authenticated role:',target.rows[0].account);
 console.log('Accounts:',result.rows[0].count);
 console.log('Schema:',missing.length?'Missing '+missing.join(', '):'Required tables available');
 if(missing.length)process.exitCode=1;
}catch(e){console.error('Database validation failed:',e.message);process.exitCode=1}finally{await client.end().catch(()=>{})}
