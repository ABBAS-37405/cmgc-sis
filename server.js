import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

const supabaseAdmin = (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Verifies the caller's Supabase access token and confirms they are a super admin.
// Returns the caller's auth user id on success, or null if unauthorized.
const requireSuperAdmin = async (accessToken) => {
  if (!supabaseAdmin || !accessToken) return null;

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData?.user) return null;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('admin_profiles')
    .select('is_super_admin')
    .eq('user_id', userData.user.id)
    .single();

  if (profileError || !profile?.is_super_admin) return null;
  return userData.user.id;
};

// Same idea, but for teacher logins: a super admin always qualifies, and so does a
// sub-admin who has been given the `teachers` permission.
const requireTeacherManager = async (accessToken) => {
  if (!supabaseAdmin || !accessToken) return null;

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData?.user) return null;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('admin_profiles')
    .select('is_super_admin, permissions')
    .eq('user_id', userData.user.id)
    .single();

  if (profileError || !profile) return null;
  if (!profile.is_super_admin && !(profile.permissions || []).includes('teachers')) return null;
  return userData.user.id;
};

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

app.post('/api/admin/create', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Admin management is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server.' });
  }

  const { accessToken, email, password, name, permissions, allowedPrograms } = req.body || {};

  const callerId = await requireSuperAdmin(accessToken);
  if (!callerId) {
    return res.status(403).json({ error: 'Only a super admin can create sub-admin accounts.' });
  }

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    return res.status(500).json({ error: createError?.message || 'Failed to create admin account.' });
  }

  const { error: profileError } = await supabaseAdmin.from('admin_profiles').insert({
    user_id: created.user.id,
    email,
    name: name || null,
    is_super_admin: false,
    permissions: Array.isArray(permissions) ? permissions : [],
    allowed_programs: Array.isArray(allowedPrograms) ? allowedPrograms : [],
    created_by: callerId,
  });

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    return res.status(500).json({ error: `Failed to save admin permissions: ${profileError.message}` });
  }

  return res.json({ success: true, userId: created.user.id });
});

app.post('/api/admin/delete', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Admin management is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server.' });
  }

  const { accessToken, targetUserId } = req.body || {};

  const callerId = await requireSuperAdmin(accessToken);
  if (!callerId) {
    return res.status(403).json({ error: 'Only a super admin can remove admin accounts.' });
  }

  if (!targetUserId) {
    return res.status(400).json({ error: 'targetUserId is required.' });
  }

  if (targetUserId === callerId) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
  if (deleteError) {
    return res.status(500).json({ error: deleteError.message });
  }

  return res.json({ success: true });
});

/**
 * Creates a teacher's login. Two shapes:
 *   - with `teacherId`  -> attaches a login to a teacher record that already exists
 *   - without           -> creates the auth user and the teachers row together
 * The auth user is rolled back if the teachers row cannot be written, so a login never
 * ends up without the record that grants it any rights.
 */
app.post('/api/teacher/create', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Teacher management is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server.' });
  }

  const { accessToken, teacherId, email, password, name, qualification, phone, subjects, programs, rights } = req.body || {};

  const callerId = await requireTeacherManager(accessToken);
  if (!callerId) {
    return res.status(403).json({ error: 'You do not have permission to manage teacher logins.' });
  }

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (!teacherId && !name) {
    return res.status(400).json({ error: 'Teacher name is required.' });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    return res.status(500).json({ error: createError?.message || 'Failed to create the teacher login.' });
  }

  const record = {
    user_id: created.user.id,
    email,
    name: name || undefined,
    qualification: qualification || null,
    phone: phone || null,
    subjects: Array.isArray(subjects) ? subjects : [],
    programs: Array.isArray(programs) ? programs : [],
    rights: Array.isArray(rights) ? rights : [],
    // Keep the legacy single-subject column populated for anything still reading it.
    subject: Array.isArray(subjects) && subjects.length > 0 ? subjects[0] : null,
  };

  const { data: teacherRow, error: rowError } = teacherId
    ? await supabaseAdmin.from('teachers').update(record).eq('id', teacherId).select().single()
    : await supabaseAdmin.from('teachers').insert(record).select().single();

  if (rowError || !teacherRow) {
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    return res.status(500).json({ error: `Failed to save the teacher record: ${rowError?.message || 'unknown error'}` });
  }

  return res.json({ success: true, teacher: teacherRow });
});

app.post('/api/teacher/password', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Teacher management is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server.' });
  }

  const { accessToken, teacherId, password } = req.body || {};

  const callerId = await requireTeacherManager(accessToken);
  if (!callerId) {
    return res.status(403).json({ error: 'You do not have permission to manage teacher logins.' });
  }

  if (!teacherId || !password) {
    return res.status(400).json({ error: 'teacherId and a new password are required.' });
  }

  const { data: teacherRow, error: lookupError } = await supabaseAdmin
    .from('teachers')
    .select('user_id')
    .eq('id', teacherId)
    .single();

  if (lookupError || !teacherRow?.user_id) {
    return res.status(404).json({ error: 'This teacher does not have a login yet.' });
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(teacherRow.user_id, { password });
  if (updateError) {
    return res.status(500).json({ error: updateError.message });
  }

  return res.json({ success: true });
});

app.post('/api/teacher/delete', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Teacher management is not configured. Set SUPABASE_SERVICE_ROLE_KEY on the server.' });
  }

  const { accessToken, teacherId } = req.body || {};

  const callerId = await requireTeacherManager(accessToken);
  if (!callerId) {
    return res.status(403).json({ error: 'You do not have permission to manage teacher logins.' });
  }

  if (!teacherId) {
    return res.status(400).json({ error: 'teacherId is required.' });
  }

  const { data: teacherRow, error: lookupError } = await supabaseAdmin
    .from('teachers')
    .select('user_id')
    .eq('id', teacherId)
    .single();

  if (lookupError || !teacherRow) {
    return res.status(404).json({ error: 'Teacher not found.' });
  }

  // Remove the record first: class_tests.teacher_id is ON DELETE SET NULL, so the test
  // history survives. Only then drop the login it pointed at.
  const { error: deleteRowError } = await supabaseAdmin.from('teachers').delete().eq('id', teacherId);
  if (deleteRowError) {
    return res.status(500).json({ error: deleteRowError.message });
  }

  if (teacherRow.user_id) {
    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(teacherRow.user_id);
    if (deleteUserError) {
      return res.status(500).json({ error: `Teacher record removed, but their login could not be deleted: ${deleteUserError.message}` });
    }
  }

  return res.json({ success: true });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Credential delivery server running on port ${PORT}`);
});
