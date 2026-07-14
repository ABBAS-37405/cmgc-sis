import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import twilio from 'twilio';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

const normalizePhone = (value) => {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('92')) return `+${digits}`;
  if (digits.startsWith('0')) return `+92${digits.slice(1)}`;
  return `+${digits}`;
};

const createEmailTransport = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURE === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
};

const emailTransport = createEmailTransport();
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

app.post('/api/send-credentials', async (req, res) => {
  const { email, whatsapp, studentName, rollNo, password } = req.body || {};

  if (!email && !whatsapp) {
    return res.status(400).json({ error: 'Provide at least one contact method (email or WhatsApp).' });
  }

  const message = [
    `Assalamualaikum ${studentName || 'Student'},`,
    '',
    'Your CMGC student portal credentials are ready.',
    '',
    `Student ID: ${rollNo}`,
    `Password: ${password}`,
    '',
    'Please use these details to login to the CMGC portal.',
    'Thank you.',
  ].join('\n');

  const results = [];

  if (email) {
    if (!emailTransport) {
      return res.status(500).json({ error: 'Email service is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in your environment.' });
    }

    try {
      await emailTransport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'CMGC Student Portal Credentials',
        text: message,
      });
      results.push({ type: 'email', status: 'sent' });
    } catch (error) {
      return res.status(500).json({ error: `Email send failed: ${error.message}` });
    }
  }

  if (whatsapp) {
    const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM;
    if (!twilioClient || !whatsappFrom) {
      return res.status(500).json({ error: 'WhatsApp service is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM in your environment.' });
    }

    try {
      await twilioClient.messages.create({
        from: `whatsapp:${whatsappFrom}`,
        to: `whatsapp:${normalizePhone(whatsapp)}`,
        body: message,
      });
      results.push({ type: 'whatsapp', status: 'sent' });
    } catch (error) {
      return res.status(500).json({ error: `WhatsApp send failed: ${error.message}` });
    }
  }

  return res.json({ success: true, results });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Credential delivery server running on port ${PORT}`);
});
