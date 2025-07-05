(async () => {
    const { makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');
    const { Boom } = await import('@hapi/boom');
    const path = await import('path');
    const fs = await import('fs');
    const chalk = (await import('chalk')).default;  // 'chalk' est un module ESM
    const qrcode = await import('qrcode-terminal');
    const P = await import('pino');
    const { MongoClient } = await import('mongodb');

// URL MongoDB
const uri = "mongodb+srv://chatgptburkina:chatgptburkina@cluster0.6yp5c3v.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri);

// Configuration
const API_URL = 'https://kaiz-apis.gleeze.com/api/kaiz-ai';
const API_KEY = '74dd332e-b020-4b19-a3e2-8574179d83a5';
const DEFAULT_UID = 1;
const AUTH_DIR = path.resolve(__dirname, 'rodhackgang_auth');

// Variables de gestion de reconnexion
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000; // 1 seconde

// UI Helpers
const log = (message, type = 'info') => {
  const colors = {
    info: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warn: chalk.yellow,
    reconnect: chalk.magenta
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

// Fonction pour se connecter à MongoDB
async function connectToDatabase() {
  try {
    await client.connect();
    log('Connecté à MongoDB', 'success');
    return client.db('chatgptburkina').collection('users');
  } catch (error) {
    log('Erreur de connexion à MongoDB: ' + error.message, 'error');
    throw error;
  }
}

// Fonction pour gérer les reconnexions
async function handleReconnection() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    log('Nombre maximum de tentatives atteint. Arrêt du bot.', 'error');
    process.exit(1);
  }

  reconnectAttempts++;
  const delayTime = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);  // Délai exponentiel

  log(`Tentative de reconnexion #${reconnectAttempts} dans ${delayTime / 1000} sec...`, 'reconnect');
  await new Promise(resolve => setTimeout(resolve, delayTime));

  try {
    await connectToWhatsApp();
  } catch (err) {
    log(`Échec reconnexion: ${err.message}`, 'error');
    await handleReconnection();
  }
}

// Fonction principale pour gérer le bot WhatsApp
async function connectToWhatsApp() {
  showWelcome();

  const usersCollection = await connectToDatabase();
  let connectionActive = false;

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
        connectionActive = true;
        reconnectAttempts = 0;  // Réinitialiser les tentatives de reconnexion
        log('Connecté à WhatsApp avec succès!', 'success');
      }

      if (connection === 'close') {
        connectionActive = false;
        const statusCode = (lastDisconnect.error instanceof Boom)
          ? lastDisconnect.error.output.statusCode
          : DisconnectReason.connectionClosed;

        log(`Déconnecté (code: ${statusCode})`, 'error');
        await handleReconnection();
      }
    });

    // Gestion des messages entrants
    sock.ev.on('messages.upsert', async ({ messages }) => {
      if (!connectionActive) return;

      const m = messages[0];
      if (!m.message) return;

      const jid = m.key.remoteJid;
      const isGroup = jid.endsWith('@g.us');
      const isFromMe = m.key.fromMe;
      const isStatus = jid === 'status@broadcast';

      if (isGroup || isFromMe || isStatus) return;

      const user = m.pushName || 'inconnu';
      const phoneNumber = m.key.remoteJid.split('@')[0];
      let text = '';

      if (m.message.conversation) {
        text = m.message.conversation;
      } else if (m.message.extendedTextMessage) {
        text = m.message.extendedTextMessage.text;
      } else {
        return;
      }

      log(`Message reçu de ${user}: ${text}`);

      try {
        let userRecord = await usersCollection.findOne({ phone: phoneNumber });

        if (!userRecord) {
          await usersCollection.insertOne({
            phone: phoneNumber,
            statusvip: false,
            messageCount: 1,
            lastMessage: new Date()
          });
        } else {
          if (userRecord.messageCount >= 50) {
            await sock.sendMessage(jid, { 
              text: `⚠️ Limite atteinte! Vous avez utilisé 50 messages gratuits.\n\nPour débloquer 1 mois d'accès illimité:\n1. Effectuez un paiement à +226 77 70 17 26 (Roger Sama)\n2. Envoyez la capture du paiement ici` 
            });
            return;
          }

          await usersCollection.updateOne(
            { phone: phoneNumber },
            { 
              $inc: { messageCount: 1 },
              $set: { lastMessage: new Date() }
            }
          );
        }

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
          await sock.sendMessage(jid, { text: "Désolé, service temporairement indisponible" });
        }
      } catch (error) {
        log(`Erreur traitement: ${error.message}`, 'error');
        await sock.sendMessage(jid, { text: "⚠️ Erreur de traitement, veuillez réessayer" });
      }
    });

  } catch (error) {
    log(`Erreur d'initialisation: ${error.message}`, 'error');
    await handleReconnection();
  }
}

// Créer le dossier d'authentification si nécessaire
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// Démarrer le bot
connectToWhatsApp();

})();
