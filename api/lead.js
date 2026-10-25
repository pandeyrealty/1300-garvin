// Vercel serverless function: receives the "Schedule a showing" form and emails the lead.
// Email is sent through Resend (https://resend.com). Set these in Vercel → Project → Settings → Environment Variables:
//   RESEND_API_KEY   (required)  your Resend API key, starts with "re_"
//   LEAD_TO_EMAIL    (optional)  where leads go. Default: pandeyrealty7@gmail.com
//   LEAD_FROM_EMAIL  (optional)  sender. Default: "1300 Garvin Website <onboarding@resend.dev>"
//                                (Resend's test sender only delivers to the email you signed up to Resend with.
//                                 After you verify your own domain in Resend, use e.g. "Leads <leads@yourdomain.com>".)

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // Spam checks: hidden "website" field must be empty, and a human takes more than ~3 seconds to fill the form.
  if (clean(body.website, 200) !== "" || Number(body.elapsed) < 3000) {
    return res.status(200).json({ ok: true }); // pretend success so bots don't retry
  }

  const lead = {
    topic: clean(body.topic, 40) || "Schedule a showing",
    name: clean(body.name, 100),
    email: clean(body.email, 150),
    phone: clean(body.phone, 30),
    date: clean(body.date, 20),
    time: clean(body.time, 20),
    message: String(body.message ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 2000),
    preapproval: body.preapproval === true,
  };

  if (!lead.name || !lead.phone || !EMAIL_RE.test(lead.email)) {
    return res.status(400).json({ ok: false, error: "Please enter your name, phone number, and a valid email." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set");
    return res.status(500).json({ ok: false, error: "Email is not configured yet." });
  }
  const to = process.env.LEAD_TO_EMAIL || "pandeyrealty7@gmail.com";
  const from = process.env.LEAD_FROM_EMAIL || "1300 Garvin Website <onboarding@resend.dev>";

  const rows = [
    ["Request", lead.topic],
    ["Name", lead.name],
    ["Phone", lead.phone],
    ["Email", lead.email],
    ["Preferred date", lead.date || "—"],
    ["Preferred time", lead.time || "—"],
    ["Wants pre-approval help", lead.preapproval ? "Yes" : "No"],
    ["Message", lead.message || "—"],
  ];
  const submitted = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });

  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17212a">
  <h2 style="margin:0 0 4px">New lead: 1300 Garvin Ave</h2>
  <p style="margin:0 0 16px;color:#5a6873">${esc(lead.topic)} · ${esc(submitted)} PT</p>
  <table cellpadding="8" style="border-collapse:collapse">
    ${rows.map(([k, v]) => `<tr><td style="border-bottom:1px solid #e3e8eb;color:#5a6873;vertical-align:top;white-space:nowrap">${k}</td><td style="border-bottom:1px solid #e3e8eb;white-space:pre-wrap">${esc(v)}</td></tr>`).join("")}
  </table>
  <p style="margin-top:16px;color:#5a6873">Reply to this email to respond to ${esc(lead.name)} directly.</p>
</div>`;
  const text = `New lead: 1300 Garvin Ave (${lead.topic})\nSubmitted ${submitted} PT\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        reply_to: lead.email,
        subject: `New lead – 1300 Garvin: ${lead.name} (${lead.topic})`,
        html,
        text,
      }),
    });
    if (!r.ok) {
      console.error("Resend error", r.status, await r.text());
      return res.status(502).json({ ok: false, error: "Could not send email." });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Lead send failed", err);
    return res.status(502).json({ ok: false, error: "Could not send email." });
  }
};
