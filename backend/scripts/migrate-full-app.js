import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL missing from backend/.env');
const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../database');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 for(const name of ['03_integrity_validation.sql','04_full_app.sql']){
  const script=await fs.readFile(path.join(directory,name),'utf8');
  await pool.query(script);
  console.log(`Applied ${name}`);
 }
 console.log('Full app migrations completed. Existing records were preserved.');
}finally{await pool.end()}
