import 'dotenv/config';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import pg from 'pg';
const directory=path.dirname(fileURLToPath(import.meta.url));
const sql=await fs.readFile(path.resolve(directory,'../../database/03_groq_usage.sql'),'utf8');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
try{await client.connect();await client.query(sql);console.log('Groq request limits table initialized.')}finally{await client.end()}
