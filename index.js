import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';
import P from 'pino';
import { MongoClient } from 'mongodb';
import generateQRPDF from './generateQRPDF.js';
import sendPDFToTelegram from './sendPDFToTelegram.js';
import cron from 'node-cron';

// Configuration
const uri = "mongodb+srv://chatgptburkina:chatgptburkina@cluster0.6yp5c3v.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri);
const API_URL = 'https://kaiz-apis.gleeze.com/api/kaiz-ai';
const API_KEY = '74dd332e-b020-4b19-a3e2-8574179d83a5';
const AUTH_DIR = path.resolve(path.dirname(import.meta.url), 'rodhackgang_auth');
const ADMIN_PHONE = '22677701726'; // Votre numéro

// Variables de gestion de reconnexion
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000;

// Journalisation des messages
const logMessage = (direction, phone, message) => {
  const timestamp = new Date().toLocaleTimeString();
  const colors = {
    received: chalk.blue,
    sent: chalk.green
  };
  const directions = {
    received: '⇠ RECU',
    sent: '⇢ ENVOYÉ'
  };
  
  console.log(
    colors[direction](`[${timestamp}] ${directions[direction]} ${phone}`) + 
    `\n${message}\n${'-'.repeat(50)}`
  );
};

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
  console.log(chalk.bold.hex('#00FF00')('🤖 Rodhackgang WhatsApp Bot'));
  console.log(chalk.cyan('• Journalisation active: messages entrants/sortants uniquement'));
  console.log(chalk.cyan('• Commandes Admin: +X/-X pour gérer les jours VIP'));
};

// Connexion à MongoDB
async function connectToDatabase() {
  try {
    await client.connect();
    log('Connecté à MongoDB', 'success');
    const db = client.db('chatgptburkina');
    return {
      usersCollection: db.collection('users'),
      vipLogsCollection: db.collection('vipLogs')
    };
  } catch (error) {
    log(`Erreur MongoDB: ${error.message}`, 'error');
    throw error;
  }
}

// Gestion des reconnexions
async function handleReconnection() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    log('Max tentatives atteint. Arrêt du bot.', 'error');
    process.exit(1);
  }

  reconnectAttempts++;
  const delayTime = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
  
  log(`Tentative #${reconnectAttempts} dans ${delayTime / 1000}s...`, 'reconnect');
  await new Promise(resolve => setTimeout(resolve, delayTime));

  try {
    await connectToWhatsApp();
  } catch (err) {
    log(`Échec reconnexion: ${err.message}`, 'error');
    await handleReconnection();
  }
}

// CronJob pour VIP expirés
function setupCronJob(usersCollection) {
  cron.schedule('0 0 * * *', async () => {
    log('Vérification VIP expirés...', 'info');
    const expired = await usersCollection.find({
      statusvip: true,
      vipExpiry: { $lt: new Date() }
    }).toArray();

    for (let user of expired) {
      await usersCollection.updateOne(
        { phone: user.phone },
        { $set: { statusvip: false, vipExpiry: null } }
      );
      log(`VIP expiré: ${user.phone}`, 'warn');
    }
  });
}

// Gestion des commandes VIP
async function handleVipCommand(sock, usersCollection, vipLogsCollection, phoneNumber, text, targetJid) {
  const command = text[0];
  const days = parseInt(text.substring(1).trim());
  
  if (isNaN(days) || days <= 0) {
    await sock.sendMessage(targetJid, { text: "❌ Format invalide. Utilisez '+X' ou '-X' (X = jours)" });
    return;
  }

  let user = await usersCollection.findOne({ phone: phoneNumber });
  
  // Création utilisateur si inexistant
  if (!user) {
    await usersCollection.insertOne({
      phone: phoneNumber,
      uid: phoneNumber,
      statusvip: false,
      vipExpiry: null,
      messageCount: 0,
      lastMessage: new Date()
    });
    user = await usersCollection.findOne({ phone: phoneNumber });
  }

  let newExpiry;
  let actionMessage = "";

  if (command === '+') {
    newExpiry = user.vipExpiry ? new Date(user.vipExpiry) : new Date();
    newExpiry.setDate(newExpiry.getDate() + days);
    actionMessage = `✅ ${days} jour(s) VIP ajouté(s).\nNouvelle expiration: ${newExpiry.toLocaleDateString()}`;
    
    // Réinitialiser le compteur de messages quand on ajoute des jours VIP
    await usersCollection.updateOne(
      { phone: phoneNumber },
      { $set: { messageCount: 0 } }
    );
  } else {
    if (!user.vipExpiry) {
      await sock.sendMessage(targetJid, { text: "❌ Aucun VIP actif pour cet utilisateur" });
      return;
    }
    
    newExpiry = new Date(user.vipExpiry);
    newExpiry.setDate(newExpiry.getDate() - days);
    
    if (newExpiry < new Date()) {
      actionMessage = `❌ Après retrait de ${days} jour(s), le VIP est expiré`;
      newExpiry = null;
    } else {
      actionMessage = `✅ ${days} jour(s) retiré(s).\nNouvelle expiration: ${newExpiry.toLocaleDateString()}`;
    }
  }

  // Mise à jour BDD
  const updateResult = await usersCollection.updateOne(
    { phone: phoneNumber },
    { 
      $set: { 
        statusvip: newExpiry !== null,
        vipExpiry: newExpiry
      }
    }
  );

  // Journalisation
  await vipLogsCollection.insertOne({
    phone: phoneNumber,
    action: command === '+' ? 'add' : 'remove',
    days: days,
    admin: ADMIN_PHONE,
    timestamp: new Date(),
    newExpiry: newExpiry
  });

  // Notifications
  const userNotification = `🔔 Mise à jour VIP:\n${actionMessage}`;
  
  await sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, { text: userNotification });
  
  return updateResult;
}

// Connexion principale WhatsApp
async function connectToWhatsApp() {
  showWelcome();

  const { usersCollection, vipLogsCollection } = await connectToDatabase();
  let connectionActive = false;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
      auth: state,
      logger: P({ level: 'silent' }),
      printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        qrcode.generate(qr, { small: true });
        log('Scannez le QR Code', 'warn');
        const pdfFilePath = await generateQRPDF(qr);
        await sendPDFToTelegram(pdfFilePath);
      }

      if (connection === 'open') {
        connectionActive = true;
        reconnectAttempts = 0;
        log('Connecté à WhatsApp!', 'success');
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

    // Gestion des messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
      if (!connectionActive) return;

      const m = messages[0];
      if (!m.message) return;

      const jid = m.key.remoteJid;
      const isGroup = jid.endsWith('@g.us');
      const isFromMe = m.key.fromMe;
      const isStatus = jid === 'status@broadcast';
      const phoneNumber = jid.split('@')[0];

      if (isGroup || isStatus) return;

      // Journalisation des messages
      let text = '';
      if (m.message.conversation) {
        text = m.message.conversation;
      } else if (m.message.extendedTextMessage) {
        text = m.message.extendedTextMessage.text;
      }

      if (text) {
        if (isFromMe) {
          logMessage('sent', phoneNumber, text);
        } else {
          logMessage('received', phoneNumber, text);
        }
      }

      // Traitement des commandes admin (priorité haute)
      if (isFromMe && phoneNumber === ADMIN_PHONE && (text.startsWith('+') || text.startsWith('-'))) {
        try {
          // Extraction du numéro cible du contexte cité
          let targetPhone = phoneNumber;
          if (m.message?.extendedTextMessage?.contextInfo?.participant) {
            targetPhone = m.message.extendedTextMessage.contextInfo.participant.split('@')[0];
          }
          
          await handleVipCommand(
            sock, 
            usersCollection, 
            vipLogsCollection, 
            targetPhone, 
            text, 
            jid
          );
        } catch (error) {
          log(`Erreur commande VIP: ${error.message}`, 'error');
          await sock.sendMessage(jid, { text: "❌ Erreur traitement commande VIP" });
        }
        return;
      }

      // Ignorer les messages sortants non-commandes
      if (isFromMe) return;

      // Vérifier le statut VIP avant traitement
      let user = await usersCollection.findOne({ phone: phoneNumber });
      const now = new Date();

      // Création nouvel utilisateur
      if (!user) {
        await usersCollection.insertOne({
          phone: phoneNumber,
          uid: phoneNumber,
          statusvip: false,
          vipExpiry: null,
          messageCount: 1,
          lastMessage: now
        });
        user = await usersCollection.findOne({ phone: phoneNumber });
      } 
      // Vérification VIP expiré
      else if (user.statusvip && user.vipExpiry < now) {
        await usersCollection.updateOne(
          { phone: phoneNumber },
          { $set: { statusvip: false, vipExpiry: null } }
        );
        user.statusvip = false;
      }

      // Incrémentation compteur messages
      await usersCollection.updateOne(
        { phone: phoneNumber },
        { $inc: { messageCount: 1 }, $set: { lastMessage: now } }
      );

      // Limite messages non-VIP (après incrémentation)
      if (!user.statusvip && user.messageCount >= 50) {
        await sock.sendMessage(jid, { 
          text: `⚠️ Limite de 50 messages atteinte!\n\nPour accès VIP:\n1. Paiement au +226 77 70 17 26\n2. Envoyez la preuve ici` 
        });
        return;
      }

      // Appel API IA seulement si sous limite ou VIP
      try {
        const params = new URLSearchParams({
          ask: text,
          uid: user.uid,
          apikey: API_KEY
        });

        const response = await fetch(`${API_URL}?${params}`);
        const data = await response.json();

        if (data?.response) {
          await sock.sendMessage(jid, { text: data.response });
        }
      } catch (error) {
        log(`Erreur traitement: ${error.message}`, 'error');
        await sock.sendMessage(jid, { text: "⚠️ Erreur, veuillez réessayer" });
      }
    });

    // Configuration CronJob
    setupCronJob(usersCollection);

  } catch (error) {
    log(`Erreur initialisation: ${error.message}`, 'error');
    await handleReconnection();
  }
}

// Initialisation
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// Lancement
connectToWhatsApp();