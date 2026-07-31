import nodemailer from 'nodemailer';

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) return null;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE ?? port === 465).toLowerCase() === 'true',
    auth: { user, pass: pass.replace(/\s+/g, '') },
  });
  return transporter;
}

export async function sendZFlowEmail({ to, subject, html }) {
  const mailer = getTransporter();
  const from = process.env.ZFLOW_EMAIL_FROM || process.env.SMTP_USER;
  if (!mailer || !from) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email delivery is not configured');
    }
    console.info('[ZFLOW EMAIL DEV]', { to, subject });
    return { id: 'development-email' };
  }

  try {
    const result = await mailer.sendMail({ from, to, subject, html });
    return { id: result.messageId };
  } catch (error) {
    console.error('[ZFLOW SMTP]', error.message);
    throw new Error('Email provider is temporarily unavailable');
  }
}
