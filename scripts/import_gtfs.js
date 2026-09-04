const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const csv = require('csv-parser');
const AdmZip = require('adm-zip');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:C0nt%40sup%40b%40s3@db.odmncyinmsoitsbtxvwt.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function createTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    await client.query(`
      CREATE TABLE IF NOT EXISTS stops (
        stop_id VARCHAR(255) PRIMARY KEY,
        stop_name VARCHAR(255),
        stop_desc TEXT,
        stop_lat DOUBLE PRECISION,
        stop_lon DOUBLE PRECISION,
        geom GEOMETRY(Point, 4326)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS stops_geom_idx ON stops USING GIST (geom);');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function parseCSVAndInsert(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping stops, file not found.`);
    return;
  }

  console.log(`Importing stops from real GTFS to Supabase...`);
  const client = await pool.connect();
  
  let stats = { read: 0, valid: 0, invalid: 0, inserted_or_updated: 0 };
  
  try {
    await client.query('BEGIN');
    
    const rows = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
            stats.read++;
            const stop_id = row.stop_id ? row.stop_id.trim() : null;
            const stop_name = row.stop_name || '';
            const stop_desc = row.stop_desc || '';
            const stop_lat = parseFloat(row.stop_lat);
            const stop_lon = parseFloat(row.stop_lon);
            
            if (!stop_id || isNaN(stop_lat) || isNaN(stop_lon) || 
                stop_lat < -90 || stop_lat > 90 || 
                stop_lon < -180 || stop_lon > 180) {
                stats.invalid++;
                return;
            }
            
            stats.valid++;
            rows.push([stop_id, stop_name, stop_desc, stop_lat, stop_lon]);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Statistics: Read: ${stats.read} | Valid: ${stats.valid} | Invalid: ${stats.invalid}`);
    console.log('Inserting into Supabase... This might take a minute.');

    const queryText = `
       INSERT INTO stops (stop_id, stop_name, stop_desc, stop_lat, stop_lon, geom) 
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)) 
       ON CONFLICT (stop_id) DO UPDATE SET
       stop_name = EXCLUDED.stop_name,
       stop_desc = EXCLUDED.stop_desc,
       stop_lat = EXCLUDED.stop_lat,
       stop_lon = EXCLUDED.stop_lon,
       geom = EXCLUDED.geom;
    `;

    for (const values of rows) {
      await client.query(queryText, values);
      stats.inserted_or_updated++;
    }

    await client.query('COMMIT');
    console.log(`Successfully committed ${stats.inserted_or_updated} rows to Supabase.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`Error importing stops:`, e);
  } finally {
    client.release();
  }
}

async function importGTFS(zipPath) {
  if (!fs.existsSync(zipPath)) {
    console.error(`File not found: ${zipPath}`);
    return;
  }
  const zip = new AdmZip(zipPath);
  const extractDir = path.join(path.dirname(zipPath), 'extracted_gtfs_' + Date.now());
  
  try {
    zip.extractAllTo(extractDir, true);
    await createTables();
    await parseCSVAndInsert(path.join(extractDir, 'stops.txt'));
  } catch (error) {
    console.error('Error processing GTFS:', error);
  } finally {
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  const targetZip = process.argv[2] || path.join(__dirname, '../../..', 'mvp', '_gtfs.zip');
  importGTFS(targetZip).then(() => {
    console.log('GTFS import process finished.');
    pool.end();
  });
}

module.exports = { importGTFS, createTables };
