const express = require('express');
const router = express.Router();
const pool = require('../db');
const axios = require('axios');

// Variable for the OpenTripPlanner engine URL
const OTP_URL = process.env.OTP_URL || 'http://localhost:8080/otp/routers/default/plan';

router.post('/transit', async (req, res) => {
    const { origin, destination } = req.body;
    
    if (!origin || !origin.lat || !origin.lng || !destination || !destination.lat || !destination.lng) {
        return res.status(400).json({ error: "Origem e Destino com lat/lng são obrigatórios." });
    }

    try {
        // Passo 1: Consultar motor de roteamento externo OTP
        const otpResponse = await axios.get(OTP_URL, {
            params: {
                fromPlace: `${origin.lat},${origin.lng}`,
                toPlace: `${destination.lat},${destination.lng}`,
                mode: 'TRANSIT,WALK',
                maxWalkDistance: 1500 // em metros
            }
        });

        const plan = otpResponse.data.plan;
        
        if (!plan || !plan.itineraries || plan.itineraries.length === 0) {
            return res.json({ routes: [], message: "Nenhuma rota encontrada." });
        }

        // Passo 2: Formatar a resposta com passos e buscar geometria detalhada do PostGIS (Shapes)
        const bestItinerary = plan.itineraries[0];
        
        const steps = await Promise.all(bestItinerary.legs.map(async (leg) => {
            const step = {
                travel_mode: leg.mode === 'WALK' ? 'WALKING' : 'TRANSIT',
                distance: { text: `${Math.round(leg.distance)} m`, value: Math.round(leg.distance) },
                duration: { text: `${Math.round(leg.duration / 60)} min`, value: leg.duration }
            };

            if (leg.mode === 'WALK') {
                step.instructions = `Ande até ${leg.to.name || 'o destino'}`;
                step.polyline = { points: leg.legGeometry.points }; // OTP encodes geometry to polyline
            } else {
                step.transit_details = {
                    departure_stop: { name: leg.from.name, location: { lat: leg.from.lat, lng: leg.from.lon } },
                    arrival_stop: { name: leg.to.name, location: { lat: leg.to.lat, lng: leg.to.lon } },
                    line: {
                        short_name: leg.routeShortName,
                        name: leg.routeLongName,
                        color: leg.routeColor ? `#${leg.routeColor}` : "#2563EB"
                    }
                };
                
                // Enriquecer a rota cruzando o tripId com os shapes do PostGIS para precisão do mapa
                if (leg.tripId) {
                    try {
                        const shapeQuery = `
                            SELECT ST_AsGeoJSON(geom) as geojson 
                            FROM shapes 
                            WHERE shape_id = (
                                SELECT shape_id FROM trips WHERE trip_id = $1 LIMIT 1
                            ) LIMIT 1;
                        `;
                        const tripIdClean = leg.tripId.includes(':') ? leg.tripId.split(':')[1] : leg.tripId;
                        const { rows } = await pool.query(shapeQuery, [tripIdClean]);
                        
                        if (rows.length > 0) {
                            step.polyline = { geojson: JSON.parse(rows[0].geojson) };
                        } else {
                            step.polyline = { points: leg.legGeometry.points };
                        }
                    } catch (dbError) {
                        console.error('Falha ao buscar shape no PostGIS, usando fallback.', dbError);
                        step.polyline = { points: leg.legGeometry.points };
                    }
                } else {
                    step.polyline = { points: leg.legGeometry.points };
                }
            }
            
            return step;
        }));

        const responsePayload = {
            routes: [
                {
                    legs: [
                        {
                            distance: { text: `${Math.round(bestItinerary.distance)} m`, value: Math.round(bestItinerary.distance) },
                            duration: { text: `${Math.round(bestItinerary.duration / 60)} min`, value: bestItinerary.duration },
                            steps: steps
                        }
                    ]
                }
            ]
        };

        res.json(responsePayload);
    } catch (error) {
        console.error('Erro na API de Rota:', error.message);
        res.status(500).json({ error: "Erro interno no cálculo de rota." });
    }
});

module.exports = router;
