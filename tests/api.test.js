const request = require('supertest');
const express = require('express');

const app = express();
app.use(express.json());

const mockQuery = jest.fn();
jest.mock('../src/db', () => ({
  query: mockQuery,
}));

const pool = require('../src/db');

app.get('/stops/nearby', async (req, res) => {
    const { lat, lon, radius = 500 } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Missing coordinates' });

    try {
        const { rows } = await pool.query('SELECT ...', [lon, lat, radius]);
        res.json({ stops: rows });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

describe('API Endpoints - Nearby Stops (UNIT TEST)', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should return 400 if lat/lon is missing', async () => {
        const response = await request(app).get('/stops/nearby');
        expect(response.status).toBe(400);
    });

    test('should return multiple stops with the SAME name but DIFFERENT ids (e.g. Parada Treze De Maio) as distinct entities', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                {
                    stop_id: '706310',
                    stop_name: 'Parada Treze De Maio',
                    stop_desc: 'Av. Brig. Lu?s Ant?nio, 1804 Ref.: Parada Treze De Maio C_b',
                    lat: -23.563939,
                    lon: -46.646414,
                    distance: 10
                },
                {
                    stop_id: '706311',
                    stop_name: 'Parada Treze De Maio',
                    stop_desc: 'Av. Brig. Lu?s Ant?nio, 1747 Ref.: Parada Treze De Maio B_c',
                    lat: -23.563730,
                    lon: -46.646115,
                    distance: 25
                }
            ]
        });

        const response = await request(app).get('/stops/nearby?lat=-23.5638&lon=-46.6462');
        expect(response.status).toBe(200);
        expect(response.body.stops).toHaveLength(2);
        expect(response.body.stops[0].stop_id).toBe('706310');
        expect(response.body.stops[1].stop_id).toBe('706311');
    });
});
