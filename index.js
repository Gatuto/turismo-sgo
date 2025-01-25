const axios = require("axios");
const fs = require("fs");
require('dotenv').config();

const API_KEY = process.env.GOOGLE_MAPS_API_KEY; // Saca la API_KEY del archivo .env. Es solo crear el archivo con GOOGLE_MAPS_API_KEY='TU_API_KEY'


// Funcion para obtener datos de un lugar
async function fetchPlaceDetails(placeId) {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${API_KEY}`;

    try {
        const { data } = await axios.get(url);
        const details = data.result;

        return {
            phone: details.formatted_phone_number || "No disponible",
            website: details.website || "No disponible",
            opening_hours: details.opening_hours?.weekday_text || "No disponible",
            reviews: details.reviews?.slice(0, 3).map(review => ({
                author: review.author_name,
                rating: review.rating,
                text: review.text,
            })) || [],
            photos: details.photos?.slice(0, 3).map(photo => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${API_KEY}`) || [],
        };
    } catch (error) {
        console.error("Error al obtener detalles:", error.message);
        return {};
    }
}

// Funcion para manejar concurrencia en solicitudes
async function fetchConcurrentDetails(placeIds, maxConcurrent = 3) {
    const results = [];
    for (let i = 0; i < placeIds.length; i += maxConcurrent) {
        const batch = placeIds.slice(i, i + maxConcurrent);
        const batchResults = await Promise.all(batch.map(fetchPlaceDetails));
        results.push(...batchResults);
    }
    return results;
}

// Funcion para agregar mas detalles
async function fetchPlacesByType(location, radius, type) {
    let places = [];
    let nextPageToken = null;

    do {
        try {
            const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location}&radius=${radius}&type=${type}&key=${API_KEY}${
                nextPageToken ? `&pagetoken=${nextPageToken}` : ""
            }`;

            const { data } = await axios.get(url);

            const batchDetails = await fetchConcurrentDetails(
                data.results.map(place => place.place_id),
                5 // Limitar a 5 requests
            );

            // Combinar datos de place y place details API
            places = places.concat(
                data.results.map((place, index) => ({
                    name: place.name,
                    address: place.vicinity || "No disponible",
                    rating: place.rating || "Sin calificación",
                    types: place.types || [],
                    coordinates: place.geometry.location || {},
                    ...batchDetails[index], // Agrega detalles
                }))
            );

            nextPageToken = data.next_page_token;
            if (nextPageToken) await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
            console.error(`Error al obtener ${type}:`, error.message);
            break;
        }
    } while (nextPageToken);

    return places;
}


// Funcion principal
async function main() {
    const location = "-27.7833,-64.2667"; // Santiago del Estero
    const radius = 5000; // Radio de 5 km
    
    // Categorías a incluir
    const categories = {
        attractions: "tourist_attraction",
        hotels: "lodging",
        restaurants: "restaurant",
        //cafes: "cafe",
        //bars: "bar",
        //markets: "supermarket",
        //malls: "shopping_mall",
    };

    const results = {};

    // Itera por cada categoría y obtiene los datos
    for (const [key, type] of Object.entries(categories)) {
        console.log(`Obteniendo datos de ${key}...`);
        results[key] = await fetchPlacesByType(location, radius, type);
    }

    // Guarda los resultados en data/info-turismo.json
    const fileName = "info-turismo.json";
    fs.writeFileSync(`data/${fileName}`, JSON.stringify(results, null, 2), "utf-8");
    console.log(`Datos guardados en data/${fileName}`);
}

main();
