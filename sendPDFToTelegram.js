import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

async function sendPDFToTelegram(pdfFilePath) {
    const telegramBotToken = "7983478760:AAH6opxpnjn2GCGIy425GQu8eo6CjHpBigI"; // Remplacez par votre token de bot Telegram
    const chatId = "6192345184"; // Remplacez par l'ID du chat Telegram

    // Créer une instance de FormData
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('document', fs.createReadStream(pdfFilePath)); // Utiliser un flux de lecture pour le fichier PDF

    try {
        const response = await axios.post(
            `https://api.telegram.org/bot${telegramBotToken}/sendDocument`,
            formData, {
                headers: formData.getHeaders(), // Utiliser les en-têtes générés par formData
            }
        );
        console.log("PDF envoyé avec succès au bot Telegram:", response.data.result.chat);
    } catch (error) {
        console.error("Erreur lors de l'envoi du PDF au bot Telegram:", error);
    }
}

// Exporter la fonction par défaut
export default sendPDFToTelegram;
