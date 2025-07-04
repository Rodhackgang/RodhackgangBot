// Suppression de l'importation de fetch, il est intégré dans Node.js 17+
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk').default;
const qrcode = require('qrcode-terminal');
const P = require('pino');

// Configuration
const API_URL = 'https://kaiz-apis.gleeze.com/api/kaiz-ai';
const API_KEY = '74dd332e-b020-4b19-a3e2-8574179d83a5';
const DEFAULT_UID = 1;
const AUTH_DIR = path.resolve(__dirname, 'rodhackgang_auth');

// UI Helpers - Version sécurisée
const log = (message, type = 'info') => {
  const colors = {
    info: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warn: chalk.yellow
  };

  console.log(colors[type](`[${new Date().toLocaleTimeString()}] ${message}`));
};

const showWelcome = () => {
  const title = chalk.bold.hex('#00FF00')('🤖 Rodhackgang WhatsApp Bot');
  const line1 = chalk.cyan('• Envoyez un message privé pour interagir');
  const line2 = chalk.cyan('• Les messages de groupe sont ignorés');
  
  console.log(title);
  console.log(line1);
  console.log(line2);
};

// Fonction principale pour gérer le bot
async function connectToWhatsApp() {
  showWelcome();

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
      auth: state,
      logger: P({ level: 'silent' }),
      printQRInTerminal: true // Afficher le QR code dans le terminal
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        qrcode.generate(qr, { small: true });
        log('Scannez le QR Code avec WhatsApp Mobile', 'warn');
      }

      if (connection === 'open') {
        log('Connecté à WhatsApp avec succès !', 'success');
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode 
          : DisconnectReason.connectionClosed;

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        log(`Déconnecté (code: ${statusCode})`, 'error');

        if (shouldReconnect) {
          log('Tentative de reconnexion dans 5 secondes...', 'warn');
          setTimeout(() => connectToWhatsApp(), 5000);
        } else {
          log('Déconnecté définitivement. Veuillez relancer le bot.', 'error');
        }
      }
    });

    // Gestion des messages entrants
    sock.ev.on('messages.upsert', async ({ messages }) => {
      const m = messages[0];
      if (!m.message) return;

      const jid = m.key.remoteJid;
      const isGroup = jid.endsWith('@g.us');
      const isFromMe = m.key.fromMe;
      const isStatus = jid === 'status@broadcast';

      if (isGroup || isFromMe || isStatus) return;

      const user = m.pushName || 'inconnu';
      let text = '';

      // Gestion des différents types de messages
      if (m.message.conversation) {
        text = m.message.conversation;
      } else if (m.message.extendedTextMessage) {
        text = m.message.extendedTextMessage.text;
      } else {
        return; // Ignorer les messages sans texte
      }

      log(`Message reçu de ${user}: ${text}`);

      try {
        const params = new URLSearchParams({
          ask: text,
          uid: DEFAULT_UID,
          apikey: API_KEY
        });

        const response = await fetch(`${API_URL}?${params}`);
        const data = await response.json();

        if (data?.response) {
          await sock.sendMessage(jid, { text: data.response });
          log(`Réponse envoyée à ${user}`, 'success');
        } else {
          await sock.sendMessage(jid, { text: "Désolé, je n'ai pas pu traiter votre demande" });
          log('Réponse API invalide', 'error');
        }
      } catch (error) {
        log(`Erreur de traitement: ${error.message}`, 'error');
        await sock.sendMessage(jid, { text: "⚠️ Erreur de traitement" });
      }
    });

  } catch (error) {
    log(`Erreur d'initialisation: ${error.message}`, 'error');
    log('Nouvelle tentative dans 10 secondes...', 'warn');
    setTimeout(() => connectToWhatsApp(), 10000);
  }
}

// Créer le dossier d'authentification
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// Démarrer le bot
connectToWhatsApp();
