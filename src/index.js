const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = require('./db');

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Busca paradas próximas baseadas no GPS
app.get('/stops/nearby', async (req, res) => {
    const { lat, lon, radius = 2000 } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Lat and Lon are required' });

    try {
        const query = `
            SELECT stop_id, stop_name, stop_desc, 
                   ST_Y(geom::geometry) as lat, 
                   ST_X(geom::geometry) as lon,
                   ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance
            FROM stops
            WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
            ORDER BY distance ASC
            LIMIT 50
        `;
        const { rows } = await pool.query(query, [lon, lat, radius]);
        res.json({ stops: rows });
    } catch (error) {
        console.error('Error in /stops/nearby:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Busca quais ônibus passam em uma parada específica (Quando clica no pino do mapa)
app.get('/stops/:id/routes', async (req, res) => {
    const { id } = req.params;
    try {
        // Mock temporário para ver a interface funcionando enquanto GTFS completo não é processado
        res.json({
            routes: [
                { route_short_name: '8700-10', route_long_name: 'Terminal Campo Limpo / Pça. Ramos' },
                { route_short_name: '702U-10', route_long_name: 'Butantã / Term. Pq. D. Pedro II' }
            ]
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Backend server running on port 3000');
});
