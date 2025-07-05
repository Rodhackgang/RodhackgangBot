import { PDFDocument } from 'pdf-lib';  // Assure-toi que 'pdf-lib' est installé
import QRCode from 'qrcode';  // Assure-toi que 'qrcode' est installé
import fs from 'fs';

async function generateQRPDF(qrCodeText) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);

  // Générer l'image QR Code
  const qrImageBuffer = await QRCode.toBuffer(qrCodeText);

  // Ajouter le QR Code à la page PDF
  const qrImage = await pdfDoc.embedPng(qrImageBuffer);

  // Obtenir la taille de l'image QR Code
  const qrImageDims = qrImage.scale(1); // Échelle à 100%

  // Calculer les coordonnées pour centrer l'image QR Code sur la page
  const x = (page.getWidth() - qrImageDims.width) / 2;
  const y = (page.getHeight() - qrImageDims.height) / 2;

  page.drawImage(qrImage, {
    x: x,
    y: y,
    width: qrImageDims.width,
    height: qrImageDims.height,
  });

  // Enregistrer le PDF
  const pdfBytes = await pdfDoc.save();
  const pdfFilePath = './qr_code.pdf';
  fs.writeFileSync(pdfFilePath, pdfBytes);
  console.log("PDF avec QR code généré avec succès :", pdfFilePath);

  return pdfFilePath;
}

// Exportation de la fonction par défaut
export default generateQRPDF;
