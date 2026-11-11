import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

// Locate SQL files beside the frontend/backend folders, independent of the current shell directory.
const dbDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database');
const target=process.env.DATABASE_URL;
if(!target)throw new Error('DATABASE_URL missing from backend/.env');
const client=new pg.Client({connectionString:target});
try{
 await client.connect();
 const existing=await client.query("SELECT to_regclass('public.users') AS users, to_regclass('public.research_projects') AS projects");
 if(existing.rows[0].users||existing.rows[0].projects){
  if(!process.argv.includes('--allow-existing'))throw new Error('Tables already exist. Back up your database and inspect schema compatibility. For a compatible schema, use --allow-existing. This tool does not delete existing tables.');
 }
 const script=await fs.readFile(path.join(dbDir,'01_schema.sql'),'utf8');
 await client.query(script);
 console.log('KnowVa schema initialized.');
 if(process.argv.includes('--with-samples')){
  const sample=await fs.readFile(path.join(dbDir,'02_sample_data_optional.sql'),'utf8');
  await client.query(sample);
  console.log('Optional team placeholders and sample literary research inserted. Their placeholder emails are NOT verified.');
 }
}finally{await client.end()}
