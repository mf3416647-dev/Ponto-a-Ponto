const fs = require('fs');
const csv = require('csv-parser');

const targetZip = 'C:/Users/mf341/Desktop/Criação de Ferramentas ATGVY/MobilityPlatform/backend/gtfs_temp/stops.txt';

let stats = { total: 0, valid: 0, invalid: 0, unique_ids: new Set(), dup_ids: 0, dup_names: 0 };
let namesSet = new Set();
let targetStops = [];

fs.createReadStream(targetZip)
  .pipe(csv())
  .on('data', (row) => {
    stats.total++;
    const stop_id = row.stop_id ? row.stop_id.trim() : null;
    const stop_name = row.stop_name || '';
    const stop_lat = parseFloat(row.stop_lat);
    const stop_lon = parseFloat(row.stop_lon);

    if (stop_id === '706310' || stop_id === '706311') {
       targetStops.push({
         id: stop_id, name: stop_name, desc: row.stop_desc,
         lat: stop_lat, lon: stop_lon
       });
    }

    if (!stop_id || isNaN(stop_lat) || isNaN(stop_lon) || stop_lat < -90 || stop_lat > 90 || stop_lon < -180 || stop_lon > 180) {
      stats.invalid++;
    } else {
      stats.valid++;
      if (stats.unique_ids.has(stop_id)) {
        stats.dup_ids++;
      } else {
        stats.unique_ids.add(stop_id);
      }
      if (namesSet.has(stop_name)) {
        stats.dup_names++;
      } else {
        namesSet.add(stop_name);
      }
    }
  })
  .on('end', () => {
    console.log('DRY-RUN STATS:');
    console.log(JSON.stringify({
      total: stats.total, valid: stats.valid, invalid: stats.invalid,
      duplicate_ids: stats.dup_ids, duplicate_names: stats.dup_names
    }, null, 2));
    console.log('TARGET STOPS FOUND:');
    console.log(JSON.stringify(targetStops, null, 2));
  });
