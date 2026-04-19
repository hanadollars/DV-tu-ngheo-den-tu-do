// api/submit-contact.js — Từ Nghèo Đến Tự Do
// CommonJS – fetch thuần, không npm packages

async function kvIncr(key) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['INCR', key]),
  });
  const data = await r.json();
  return data.result;
}

async function kvSet(key, value, ex) {
  await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SET', key, value, 'EX', ex]),
  });
}

async function sendEmail({ to, subject, html }) {
  const fromEmail = process.env.FROM_EMAIL || 'no-reply@hanadola.com';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: fromEmail, to, subject, html }),
  });
  const text = await r.text();
  console.log('[Resend] TO:', to, '| status:', r.status, '| resp:', text);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, email, need, description } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'Vui lòng điền họ tên và số điện thoại' });
  }

  const submittedAt = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  let leadId = 'TNTD-0001';
  try {
    const counter = await kvIncr('tntd_contact_counter');
    leadId = `TNTD-${String(counter).padStart(4, '0')}`;
    await kvSet(`lead:${leadId}`, JSON.stringify({
      leadId, name, phone, email: email || '', need: need || '',
      description: description || '', submittedAt,
    }), 86400 * 90);
    console.log('[Contact] Lead:', leadId, '|', name, '|', phone);
  } catch (err) {
    console.error('[KV] Lỗi:', err.message);
  }

  // Email admin thông báo
  const notifyEmail = process.env.NOTIFY_EMAIL;
  if (notifyEmail) {
    try {
      await sendEmail({
        to: notifyEmail,
        subject: `[TNTD] Liên hệ mới — ${name} — ${phone}`,
        html: `<div style="font-family:'Segoe UI',sans-serif;max-width:520px;padding:28px;background:#0B1628;color:#E8EDF5;border-radius:10px">
<h2 style="color:#64B5F6;font-size:18px;margin:0 0 20px">📩 Liên hệ tư vấn mới</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px">
  <tr><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:rgba(232,237,245,0.45);width:35%">Mã lead</td><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:#64B5F6;font-weight:700">${leadId}</td></tr>
  <tr><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:rgba(232,237,245,0.45)">Họ tên</td><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-weight:600">${name}</td></tr>
  <tr><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:rgba(232,237,245,0.45)">Điện thoại</td><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><a href="tel:${phone}" style="color:#64B5F6;text-decoration:none">${phone}</a></td></tr>
  <tr><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:rgba(232,237,245,0.45)">Email</td><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06)">${email || '(không có)'}</td></tr>
  <tr><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:rgba(232,237,245,0.45)">Nhu cầu</td><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06)">${need || '(không chọn)'}</td></tr>
  <tr><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:rgba(232,237,245,0.45)">Mô tả</td><td style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06)">${description || '(không có)'}</td></tr>
  <tr><td style="padding:9px 0;color:rgba(232,237,245,0.45)">Thời gian</td><td style="padding:9px 0">${submittedAt}</td></tr>
</table>
</div>`,
      });
    } catch (err) {
      console.error('[Email] Lỗi admin:', err.message);
    }
  }

  // Email xác nhận cho khách hàng
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    try {
      await sendEmail({
        to: email,
        subject: `✅ Đã nhận yêu cầu tư vấn — Từ Nghèo Đến Tự Do`,
        html: `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
<style>
body{font-family:'Segoe UI',Georgia,serif;background:#0B1628;color:#E8EDF5;margin:0;padding:0}
.wrap{max-width:500px;margin:0 auto;padding:40px 24px}
.brand{font-size:11px;letter-spacing:3px;color:rgba(100,181,246,0.55);text-transform:uppercase;margin-bottom:28px}
h1{font-size:22px;font-weight:300;margin-bottom:8px;font-family:Georgia,serif;color:#fff}
h1 em{color:#64B5F6;font-style:italic}
p{font-size:14px;color:rgba(232,237,245,0.6);line-height:1.8;margin-bottom:14px}
.box{background:rgba(255,255,255,0.04);border:1px solid rgba(100,181,246,0.15);border-radius:6px;padding:18px 22px;margin:20px 0}
.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:13px}
.row:last-child{border-bottom:none}
.lb{color:rgba(232,237,245,0.4)}.vl{color:#E8EDF5;font-weight:500}
.footer{margin-top:32px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(100,181,246,0.3);text-align:center}
</style></head><body><div class="wrap">
<div class="brand">Hanadola Media &amp; Technology · Từ Nghèo Đến Tự Do</div>
<h1>Xin chào, <em>${name}</em>!</h1>
<p>Chúng tôi đã nhận được yêu cầu tư vấn. Đội ngũ sẽ liên hệ qua số <strong style="color:#fff">${phone}</strong> trong vòng <strong style="color:#64B5F6">2 giờ làm việc</strong>.</p>
<div class="box">
  <div class="row"><span class="lb">Mã yêu cầu</span><span class="vl" style="color:#64B5F6">${leadId}</span></div>
  <div class="row"><span class="lb">Nhu cầu</span><span class="vl">${need || 'Chưa chọn'}</span></div>
  <div class="row"><span class="lb">Thời gian</span><span class="vl">${submittedAt}</span></div>
</div>
<p>Bạn cũng có thể liên hệ trực tiếp:<br>
📱 Fanpage: <a href="https://facebook.com/Tungheodentudo" style="color:#64B5F6">facebook.com/Tungheodentudo</a><br>
📞 Hotline: <a href="tel:0703965703" style="color:#64B5F6">0703.965.703</a></p>
<div class="footer">© 2026 Công ty TNHH Hanadola Media &amp; Technology<br>P903, Tầng 9, Diamond Plaza, 34 Lê Duẩn, TP.HCM · MST: 0319352856</div>
</div></body></html>`,
      });
    } catch (err) {
      console.error('[Email] Lỗi khách:', err.message);
    }
  }

  return res.status(200).json({ success: true, leadId });
};
