import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import twilio from "twilio";
import dotenv from "dotenv";
import compression from "compression";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, updateDoc } from "firebase/firestore";

const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf-8"));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(compression());
  // Augmenter la limite pour supporter l'upload de grandes images en base64
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Configurer le répertoire local d'upload d'images de secours
  const uploadsPath = path.join(process.cwd(), "public", "uploads");
  if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
  }
  app.use("/uploads", express.static(uploadsPath));

  const distUploadsPath = path.join(process.cwd(), "dist", "uploads");
  if (fs.existsSync(distUploadsPath)) {
    app.use("/uploads", express.static(distUploadsPath));
  }

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.post("/api/bot/analyze-pdf", async (req, res) => {
    const { pdfUrl } = req.body;
    if (!pdfUrl) return res.status(400).json({ error: "Missing pdfUrl" });
    
    try {
      const response = await fetch(pdfUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const data = await pdfParse(buffer);
      const text = data.text;
      
      const aiResponse = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ role: 'user', parts: [{ text: `Analyse ce document technique ou pédagogique et ajoute ces connaissances aux règles de Madagascar Designer :
        ${text.substring(0, 10000)}... 
        
        Renvoie SEULEMENT un JSON avec ces champs:
        { "summary": "...", "newInstructions": "..." }
        ` }] }]
      });
      
      const resultText = aiResponse.text || "{}";
      const cleanJson = resultText.replace(/```json\n|\n```/g, '');
      const json = JSON.parse(cleanJson);
      
      const botDocRef = doc(db, 'config', 'bot');
      const botDoc = await getDoc(botDocRef);
      const currentConfig = botDoc.exists() ? botDoc.data() : { instructions: '', trainingFiles: [] };
      
      await updateDoc(botDocRef, {
        instructions: (currentConfig.instructions || "") + "\n\nNOUVELLE CONNAISSANCE : " + json.summary + "\n\nNOUVELLES RÈGLES : " + json.newInstructions,
        trainingFiles: [...(currentConfig.trainingFiles || []), pdfUrl]
      });
      
      res.json({ success: true, summary: json.summary });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Nouveau endpoint d'upload local de secours si Firebase Storage n'est pas configuré/actif
  app.post("/api/upload", async (req, res) => {
    try {
      const { fileName, fileType, base64Data } = req.body;
      if (!fileName || !base64Data) {
        return res.status(400).json({ error: "fileName or base64Data is missing" });
      }

      console.log(`[Backup Upload] Receiving file: ${fileName} (${fileType})`);
      const buffer = Buffer.from(base64Data, "base64");

      // Écriture sur le chemin local de dev
      const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "");
      const finalDevPath = path.join(uploadsPath, safeName);
      await fs.promises.writeFile(finalDevPath, buffer);

      // Si le dossier dist de prod existe, écrire également dedans pour s'assurer qu'il est servi en prod
      const distDir = path.join(process.cwd(), "dist", "uploads");
      if (fs.existsSync(path.join(process.cwd(), "dist"))) {
        if (!fs.existsSync(distDir)) {
          fs.mkdirSync(distDir, { recursive: true });
        }
        await fs.promises.writeFile(path.join(distDir, safeName), buffer);
      }

      const fileUrl = `/uploads/${safeName}`;
      console.log(`[Backup Upload] Saved successfully: ${fileUrl}`);
      res.json({ url: fileUrl });
    } catch (err: any) {
      console.error("[Backup Upload] Error saving file:", err);
      res.status(500).json({ error: err.message || "Failed to save file" });
    }
  });

  // Email sending route for quotes
  app.post("/api/send-quote-email", async (req, res) => {
    const { quoteData } = req.body;
    
    if (!quoteData) {
      return res.status(400).json({ error: "Données du devis manquantes" });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"MadaDesigner Quotes" <${process.env.SMTP_USER}>`,
      to: "madesign.architect3d@gmail.com",
      subject: `Nouveau Devis - ${quoteData.projectType} - ${quoteData.clientInfo.name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
          <h2 style="color: #A4C639;">Nouveau Devis Généré</h2>
          <p>Un nouveau devis a été créé sur le site.</p>
          
          <h3 style="border-bottom: 2px solid #A4C639; padding-bottom: 5px;">Informations Client</h3>
          <p><strong>Nom:</strong> ${quoteData.clientInfo.name}</p>
          <p><strong>Email:</strong> ${quoteData.clientInfo.email}</p>
          <p><strong>Téléphone:</strong> ${quoteData.clientInfo.phone}</p>
          <p><strong>Message:</strong> ${quoteData.clientInfo.message || "Aucun message"}</p>
          
          <h3 style="border-bottom: 2px solid #A4C639; padding-bottom: 5px;">Détails du Projet</h3>
          <p><strong>Type de projet:</strong> ${quoteData.projectType}</p>
          <p><strong>Surface:</strong> ${quoteData.surface} m²</p>
          <p><strong>Complexité:</strong> ${quoteData.complexity}</p>
          <p><strong>Options:</strong> ${quoteData.selectedOptions.join(", ") || "Aucune"}</p>
          <p><strong>Prix Estimé:</strong> ${quoteData.totalPrice.toLocaleString()} Ar</p>
          
          <p style="margin-top: 30px; font-size: 12px; color: #888;">Ceci est un message automatique envoyé depuis votre site web.</p>
        </div>
      `,
    };

    try {
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn("SMTP credentials not configured. Skipping email send.");
        return res.status(200).json({ message: "Devis enregistré mais email non configuré" });
      }
      
      await transporter.sendMail(mailOptions);
      res.status(200).json({ message: "Email envoyé avec succès" });
    } catch (error) {
      console.error("Erreur lors de l'envoi de l'email:", error);
      res.status(500).json({ error: "Erreur lors de l'envoi de l'email" });
    }
  });

  // WhatsApp sending route for quotes
  app.post("/api/send-quote-whatsapp", async (req, res) => {
    const { quoteData } = req.body;
    
    if (!quoteData) {
      return res.status(400).json({ error: "Données du devis manquantes" });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    let fromNumber = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
    if (!fromNumber.startsWith("whatsapp:")) {
      fromNumber = `whatsapp:${fromNumber}`;
    }
    
    const defaultTo = "whatsapp:+261340499999";
    let toNumber = process.env.TWILIO_WHATSAPP_TO;

    const isValidPhoneNumber = (num: string) => {
      // Basic regex for whatsapp:+[country code][number]
      return /^whatsapp:\+[1-9]\d{1,14}$/.test(num);
    };

    if (toNumber) {
      if (!toNumber.startsWith("whatsapp:")) {
        toNumber = `whatsapp:${toNumber}`;
      }
      if (!isValidPhoneNumber(toNumber)) {
        console.warn(`Twilio warning: Invalid 'To' format in env (${toNumber}), using default: ${defaultTo}`);
        toNumber = defaultTo;
      }
    } else {
      toNumber = defaultTo;
    }

    // We removed the sandbox fallback which overrides the user's `fromNumber`
    // because it causes Twilio Error 63007 (Channel not found) when the Twilio
    // account hasn't activated that specific Sandbox number. 
    if (fromNumber === toNumber && fromNumber !== "whatsapp:+14155238886") {
      console.warn(`Twilio Warning: Sender (From) and Recipient (To) are the exact same number (${fromNumber}). Twilio may reject this. Please use different numbers for From and To in your .env if this fails.`);
    }

    if (!accountSid || !authToken) {
      console.warn("Twilio credentials not configured. Skipping WhatsApp send.");
      return res.status(200).json({ message: "Devis enregistré mais WhatsApp non configuré" });
    }

    const client = twilio(accountSid, authToken);

    const message = `
*Nouveau Devis Généré*
----------------------
*Client:* ${quoteData.clientInfo.name}
*Email:* ${quoteData.clientInfo.email}
*Téléphone:* ${quoteData.clientInfo.phone}
*Projet:* ${quoteData.projectType}
*Surface:* ${quoteData.surface} m²
*Complexité:* ${quoteData.complexity}
*Prix Estimé:* ${quoteData.totalPrice.toLocaleString()} Ar
----------------------
_Envoyé depuis MadaDesigner_
    `.trim();

    try {
      await client.messages.create({
        body: message,
        from: fromNumber,
        to: toNumber,
      });
      res.status(200).json({ message: "WhatsApp envoyé avec succès" });
    } catch (error: any) {
      if (error?.code === 63007) {
         console.error(`\n[Twilio Error 63007]: L'expéditeur (From) "${fromNumber}" n'est pas autorisé ou enregistré dans votre compte Twilio. Vérifiez votre variable TWILIO_WHATSAPP_FROM dans le fichier .env.\n`);
      } else {
         console.error("Erreur lors de l'envoi du message WhatsApp:", error?.message || error);
      }
      // Note: We return 200 so the frontend doesn't show an ugly "error" popup to the end user for backend integrations
      res.status(200).json({ message: "Devis enregistré, mais échec de notification WhatsApp", error: true });
    }
  });

  // WhatsApp sending route for chat messages
  app.post("/api/send-chat-whatsapp", async (req, res) => {
    const { message, history } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "Message manquant" });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    let fromNumber = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
    if (!fromNumber.startsWith("whatsapp:")) {
      fromNumber = `whatsapp:${fromNumber}`;
    }
    
    const defaultTo = "whatsapp:+261340499999";
    let toNumber = process.env.TWILIO_WHATSAPP_TO;

    const isValidPhoneNumber = (num: string) => {
      // Basic regex for whatsapp:+[country code][number]
      return /^whatsapp:\+[1-9]\d{1,14}$/.test(num);
    };

    if (toNumber) {
      if (!toNumber.startsWith("whatsapp:")) {
        toNumber = `whatsapp:${toNumber}`;
      }
      if (!isValidPhoneNumber(toNumber)) {
        console.warn(`Twilio warning: Invalid 'To' format in env (${toNumber}), using default: ${defaultTo}`);
        toNumber = defaultTo;
      }
    } else {
      toNumber = defaultTo;
    }

    if (fromNumber === toNumber && fromNumber !== "whatsapp:+14155238886") {
      console.warn(`Twilio Warning: Sender (From) and Recipient (To) are the exact same number (${fromNumber}). Twilio may reject this. Please use different numbers for From and To in your .env if this fails.`);
    }

    if (!accountSid || !authToken) {
      console.warn("Twilio credentials not configured. Skipping WhatsApp send.");
      return res.status(200).json({ message: "Message enregistré mais WhatsApp non configuré" });
    }

    const client = twilio(accountSid, authToken);

    const text = `
*Nouveau Message Chatbot*
----------------------
*Message:* ${message}
----------------------
_Envoyé depuis MadaDesigner_
    `.trim();

    try {
      await client.messages.create({
        body: text,
        from: fromNumber,
        to: toNumber,
      });
      res.status(200).json({ message: "WhatsApp envoyé avec succès" });
    } catch (error: any) {
      if (error?.code === 63007) {
         console.error(`\n[Twilio Error 63007]: L'expéditeur (From) "${fromNumber}" n'est pas configuré dans votre compte Twilio. Vérifiez votre variable TWILIO_WHATSAPP_FROM.\n`);
      } else {
         console.error("Erreur API Twilio WhatsApp:", error?.message || error);
      }
      res.status(200).json({ message: "Message traité, notification WhatsApp échouée", error: true });
    }
  });

  // Example API for leads
  app.post("/api/leads", (req, res) => {
    const lead = req.body;
    console.log("New lead received:", lead);
    res.status(201).json({ message: "Lead received successfully", id: Date.now() });
  });

  // API Route for sending Chatbot Lead (Contact/Coordonnées récoltées) automatically to YAH (Mail + WhatsApp)
  app.post("/api/send-lead-data", async (req, res) => {
    const { name, phone, location, optionalMessage, precalculatedDemand } = req.body;

    if (!name || !phone || !location) {
      return res.status(400).json({ error: "Champs obligatoires manquants" });
    }

    // 1. Prepare and send Email to YAH
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"MadaDesigner Client" <${process.env.SMTP_USER || "madesign.architect3d@gmail.com"}>`,
      to: "madesign.architect3d@gmail.com",
      subject: `[Nouveau Prospect Chatbot] - ${name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
          <h2 style="color: #A4C639; border-bottom: 2px solid #A4C639; padding-bottom: 10px;">Nouveau Prospect Chatbot</h2>
          <p>Un visiteur a laissé ses coordonnées via le chatbot assistant.</p>
          
          <h3 style="color: #333; margin-top: 20px;">Coordonnées du Prospect</h3>
          <p><strong>Nom :</strong> ${name}</p>
          <p><strong>Téléphone :</strong> ${phone}</p>
          <p><strong>Lieu du Projet :</strong> ${location}</p>
          <p><strong>Message d'accroche :</strong> ${optionalMessage || "Non spécifié"}</p>
          
          <h3 style="color: #333; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px;">Détails Précalculés (Demande)</h3>
          <p style="background: #f9f9f9; padding: 10px; border-radius: 5px; font-style: italic; color: #555;">
            ${precalculatedDemand || "Aucun projet spécifique n'a été précalculé."}
          </p>
          
          <p style="margin-top: 30px; font-size: 11px; color: #888; border-top: 1px solid #eee; padding-top: 10px;">
            Ceci est un message automatique envoyé depuis le chatbot Madagascar Designer.
          </p>
        </div>
      `,
    };

    let emailSent = false;
    try {
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        await transporter.sendMail(mailOptions);
        emailSent = true;
      } else {
        console.warn("SMTP credentials not configured. Skipping email send for lead.");
      }
    } catch (error) {
      console.error("Erreur d'envoi d'email pour le lead:", error);
    }

    // 2. Prepare and send WhatsApp to YAH via Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    let fromNumber = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
    if (!fromNumber.startsWith("whatsapp:")) {
      fromNumber = `whatsapp:${fromNumber}`;
    }
    
    const defaultTo = "whatsapp:+261340499999";
    let toNumber = process.env.TWILIO_WHATSAPP_TO || defaultTo;
    if (!toNumber.startsWith("whatsapp:")) {
      toNumber = `whatsapp:${toNumber}`;
    }

    const whatsAppMessage = `
*Nouveau Prospect Chatbot*
----------------------
*Nom:* ${name}
*Tél:* ${phone}
*Lieu du projet:* ${location}
*Message d'accroche:* ${optionalMessage || "Aucun"}
*Demande précalculée:* ${precalculatedDemand || "Non spécifiée"}
----------------------
_MadaDesigner_
    `.trim();

    let whatsappSent = false;
    try {
      if (accountSid && authToken) {
        const client = twilio(accountSid, authToken);
        await client.messages.create({
          body: whatsAppMessage,
          from: fromNumber,
          to: toNumber,
        });
        whatsappSent = true;
      } else {
        console.warn("Twilio credentials not configured. Skipping server-side WhatsApp lead message.");
      }
    } catch (error) {
      console.error("Erreur API Twilio WhatsApp pour le lead:", error);
    }

    res.status(200).json({
      success: true,
      emailSent,
      whatsappSent,
      message: "Lead enregistré et notifications envoyées !"
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
