const axios = require('axios');
const protobuf = require('protobufjs');
const NodeCache = require('node-cache');
const path = require('path');

// Cache config: keep data for 5 minutes (300 seconds)
const cache = new NodeCache({ stdTTL: 300 });
const CACHE_KEY = 'gtfs-rt-data';

// Generic GTFS-RT Protobuf URL
const GTFS_RT_URL = process.env.GTFS_RT_URL || 'https://example.com/gtfs-rt';
// Assume we have a gtfs-realtime.proto file in the project
const PROTO_PATH = path.resolve(__dirname, '../../protos/gtfs-realtime.proto');

/**
 * Fetches and parses live GTFS-RT data.
 * Falls back to cached data if the external API is down.
 */
async function getLiveTransitData() {
    try {
        // Load the GTFS-RT protobuf schema
        const root = await protobuf.load(PROTO_PATH);
        const FeedMessage = root.lookupType('transit_realtime.FeedMessage');

        // Fetch live data from the external API
        const response = await axios.get(GTFS_RT_URL, {
            responseType: 'arraybuffer',
            timeout: 5000 // 5 seconds timeout
        });

        // Decode the protobuf message
        const message = FeedMessage.decode(new Uint8Array(response.data));
        const data = FeedMessage.toObject(message, {
            enums: String,  // enums as string names
            longs: String,  // longs as strings (requires long.js)
            bytes: String,  // bytes as base64 encoded strings
            defaults: true, // includes default values
            arrays: true,   // populates empty arrays (repeated fields) even if defaults=false
            objects: true,  // populates empty objects (map fields) even if defaults=false
            oneofs: true    // includes virtual oneof fields set to the present field's name
        });

        // Cache the successful response
        cache.set(CACHE_KEY, data);

        return {
            source: 'live',
            data: data
        };

    } catch (error) {
        console.error('Error fetching live GTFS-RT data:', error.message);

        // Fallback to cache
        const cachedData = cache.get(CACHE_KEY);
        if (cachedData) {
            console.log('Serving GTFS-RT data from cache as fallback.');
            return {
                source: 'cache',
                data: cachedData
            };
        }

        // If no cache is available, throw or return an error structure
        throw new Error('GTFS-RT API is down and no cached data is available.');
    }
}

module.exports = {
    getLiveTransitData
};
