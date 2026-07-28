// SMS + WhatsApp delivery via Twilio.
//
// SMS works as soon as TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
// TWILIO_FROM_NUMBER / ALERT_SMS_TO are set.
//
// WhatsApp additionally requires the Twilio WhatsApp sandbox to be activated
// (a terms acceptance in the Twilio console) and the recipient to have joined
// the sandbox from their own WhatsApp. Until then sends fail with a 63007-ish
// error, which we swallow and report rather than throwing — a missing
// WhatsApp channel must never break a briefing.

type Channel = "sms" | "whatsapp";

function creds() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return sid && token ? { sid, token } : null;
}

export function twilioConfigured(channel: Channel) {
  if (!creds()) return false;
  if (channel === "sms") {
    return Boolean(process.env.TWILIO_FROM_NUMBER && process.env.ALERT_SMS_TO);
  }
  return Boolean(process.env.TWILIO_WHATSAPP_FROM && process.env.ALERT_SMS_TO);
}

export async function sendTwilioMessage(channel: Channel, body: string) {
  const c = creds();
  if (!c) return { sent: false as const, reason: "twilio-not-configured" };

  const to = process.env.ALERT_SMS_TO;
  if (!to) return { sent: false as const, reason: "no-recipient" };

  const from =
    channel === "sms" ? process.env.TWILIO_FROM_NUMBER : process.env.TWILIO_WHATSAPP_FROM;
  if (!from) return { sent: false as const, reason: `no-${channel}-sender` };

  const params = new URLSearchParams({
    To: channel === "whatsapp" ? `whatsapp:${to}` : to,
    From: from,
    // Twilio hard-caps at 1600 chars; SMS segments at 160. Keep it tight.
    Body: body.slice(0, 1500),
  });

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${c.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${c.sid}:${c.token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    if (!response.ok) {
      const text = await response.text();
      console.error(`Twilio ${channel} failed (${response.status}): ${text.slice(0, 300)}`);
      return { sent: false as const, reason: `http-${response.status}` };
    }
    return { sent: true as const };
  } catch (err) {
    console.error(`Twilio ${channel} threw:`, err);
    return { sent: false as const, reason: "exception" };
  }
}
