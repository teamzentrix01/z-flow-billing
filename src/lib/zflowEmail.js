export async function sendZFlowEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ZFLOW_EMAIL_FROM;
  if (!apiKey || !from) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email delivery is not configured');
    }
    console.info('[ZFLOW EMAIL DEV]', { to, subject });
    return { id: 'development-email' };
  }

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
  } catch {
    throw new Error('Email provider is temporarily unavailable');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'Email delivery failed');
  return payload;
}
