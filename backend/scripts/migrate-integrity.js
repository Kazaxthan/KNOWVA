import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL in backend/.env first.');
const base=path.dirname(fileURLToPath(import.meta.url));
const sql=await fs.readFile(path.resolve(base,'../../database/03_integrity_validation.sql'),'utf8');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{await pool.query(sql);console.log('KnowVa integrity & validation migration applied successfully.')}finally{await pool.end()}
