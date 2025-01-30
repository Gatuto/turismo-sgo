const axios = require("axios");
const fs = require("fs");
const PDFDocument = require("pdfkit");
require('dotenv').config();

const API_KEY = process.env.GOOGLE_MAPS_API_KEY; // Saca la API_KEY del archivo .env. Es solo crear el archivo con GOOGLE_MAPS_API_KEY='TU_API_KEY'

// Funcion para obtener descripcion de Wikipedia
async function fetchWikipediaDescription(placeName) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(placeName)}`;
    try {
        const { data } = await axios.get(url);
        return data.extract || "Descripción no disponible";
    } catch (error) {
        console.warn(`No se encontró descripción en Wikipedia para: ${placeName}`);
        return "Descripción no disponible";
    }
}

// Funcion para obtener datos de un lugar
async function fetchPlaceDetails(placeId, name) {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${API_KEY}`;
    try {
        const { data } = await axios.get(url);
        const details = data.result;
        const wikipediaDescription = await fetchWikipediaDescription(name);

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
            description: wikipediaDescription,
        };
    } catch (error) {
        console.error("Error al obtener detalles:", error.message);
        return {};
    }
}

// Función para manejar concurrencia en solicitudes
async function fetchConcurrentDetails(places, maxConcurrent = 3) {
    const results = [];
    for (let i = 0; i < places.length; i += maxConcurrent) {
        const batch = places.slice(i, i + maxConcurrent);
        const batchResults = await Promise.all(batch.map(({ place_id, name }) => fetchPlaceDetails(place_id, name)));
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
                data.results.map(place => ({ place_id: place.place_id, name: place.name })),
                5 // Limita a 5 requests
            );

            places = places.concat(
                data.results.map((place, index) => ({
                    name: place.name,
                    address: place.vicinity || "No disponible",
                    rating: place.rating || "Sin calificación",
                    types: place.types || [],
                    coordinates: place.geometry.location || {},
                    ...batchDetails[index],
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

// Funcion para guardar en PDF
function saveToPDF(data, fileName) {
    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(`data/${fileName}`));
    
    doc.fontSize(18).text("Información Turística", { align: "center" });
    doc.moveDown();
    
    for (const [category, places] of Object.entries(data)) {
        doc.fontSize(16).text(category.toUpperCase(), { underline: true });
        doc.moveDown();
        
        places.forEach(place => {
            doc.fontSize(14).text(place.name, { bold: true });
            doc.fontSize(12).text(`Dirección: ${place.address}`);
            doc.text(`Calificación: ${place.rating}`);
            doc.text(`Teléfono: ${place.phone}`);
            doc.text(`Sitio web: ${place.website}`);
            doc.text("Descripción: " + place.description);
            doc.moveDown(1.5);
        });
    }
    
    doc.end();
}

// Funcion principal
async function main() {
    const location = "-27.7833,-64.2667"; // Santiago del Estero
    const radius = 5000; // Radio de 5 km
    
    // Categorias a incluir
    const categories = {
        //attractions: "tourist_attraction",
        hotels: "lodging",
        //restaurants: "restaurant",
        //cafes: "cafe",
        //bars: "bar",
        //markets: "supermarket",
        //malls: "shopping_mall",
    };
    
    const results = {};
    for (const [key, type] of Object.entries(categories)) {
        console.log(`Obteniendo datos de ${key}...`);
        results[key] = await fetchPlacesByType(location, radius, type);
    }
    
    // Guarda los resultados en data/info-turismo.pdf
    const fileName = "info-turismo.pdf";
    saveToPDF(results, fileName);
    console.log(`PDF guardado en data/${fileName}`);
}

main();
