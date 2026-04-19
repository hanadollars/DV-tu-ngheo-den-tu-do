// api/sepay-webhook.js — Tu Ngheo Den Tu Do
// CommonJS – fetch thuần, không npm packages

const ORDER_CODE_REGEX = /TNTD[A-Z0-9]{4}/i;
const EINVOICE_BASE = 'https://einvoice-api.sepay.vn';

// ─── KV helpers ──────────────────────────────────────────────────────────────
async function kvGet(key) {
  const r = await fetch(
    `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` } }
  );
  const d = await r.json();
  return d.result;
}

async function kvSet(key, value, ex) {
  await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', key, value, 'EX', ex]),
  });
}

async function kvIncr(key) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['INCR', key]),
  });
  const d = await r.json();
  return d.result;
}

// ─── SePay eInvoice ───────────────────────────────────────────────────────────
async function getSepayEInvoiceToken() {
  const clientId     = process.env.SEPAY_EINVOICE_CLIENT_ID;
  const clientSecret = process.env.SEPAY_EINVOICE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.log('[eInvoice] MISSING: CLIENT_ID hoặc CLIENT_SECRET');
    return null;
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await fetch(`${EINVOICE_BASE}/v1/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
  });
  const text = await r.text();
  console.log('[eInvoice] Token status:', r.status, '| body:', text);
  let data; try { data = JSON.parse(text); } catch(e) { data = {}; }
  return data?.data?.access_token || null;
}

async function issueSepayEInvoice({ token, order, transferAmount }) {
  const providerAccountId = process.env.SEPAY_EINVOICE_PROVIDER_ACCOUNT_ID;
  const templateCode      = process.env.SEPAY_EINVOICE_TEMPLATE_CODE;
  const invoiceSeries     = process.env.SEPAY_EINVOICE_SERIES;
  if (!providerAccountId || !templateCode || !invoiceSeries) {
    console.log('[eInvoice] MISSING provider/template/series vars');
    return null;
  }
  const issuedDate = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const payload = {
    template_code: templateCode,
    invoice_series: invoiceSeries,
    issued_date: issuedDate,
    currency: 'VND',
    provider_account_id: providerAccountId,
    payment_method: 'CK',
    buyer: { name: order.name, email: order.email },
    items: [{
      line_number: 1,
      line_type: 1,
      item_code: 'EBOOK-TNTD-001',
      item_name: 'Ebook Từ Nghèo Đến Tự Do (PDF) – 30 bài học tài chính cốt lõi',
      unit: 'Quyển',
      quantity: 1,
      unit_price: transferAmount || 149000,
      tax_rate: -2,
    }],
    is_draft: false,
  };
  console.log('[eInvoice] Tạo hóa đơn cho:', order.email);
  const r = await fetch(`${EINVOICE_BASE}/v1/invoices/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  console.log('[eInvoice] Create status:', r.status, '| body:', text);
  let data; try { data = JSON.parse(text); } catch(e) { data = {}; }
  if (!data?.success || !data?.data?.tracking_code) {
    console.warn('[eInvoice] Thất bại:', text);
    return null;
  }
  console.log('[eInvoice] ✅ tracking_code:', data.data.tracking_code);
  return { tracking_code: data.data.tracking_code, status: 'processing' };
}

// ─── Resend email ─────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  const fromEmail = process.env.FROM_EMAIL || 'no-reply@hanadola.com';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to, subject, html }),
  });
  const text = await r.text();
  console.log('[Resend] TO:', to, '| status:', r.status, '| resp:', text);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Apikey ${process.env.SEPAY_API_KEY}`) {
    console.error('[Webhook] Unauthorized:', authHeader);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body;
  console.log('[Webhook] Received:', JSON.stringify(body));

  const content        = body.content || body.description || '';
  const transferAmount = parseInt(body.transferAmount || body.amount || 0, 10);

  const match = content.match(ORDER_CODE_REGEX);
  if (!match) {
    console.warn('[Webhook] Không có mã TNTD trong:', content);
    return res.status(200).json({ message: 'No order code – ignored' });
  }

  const orderCode = match[0].toUpperCase();
  console.log('[Webhook] orderCode:', orderCode, '| amount:', transferAmount);

  const raw = await kvGet(`order:${orderCode}`);
  if (!raw) return res.status(200).json({ message: 'Order not found – ignored' });

  const order = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (order.status === 'paid') return res.status(200).json({ message: 'Already processed' });

  const counter       = await kvIncr('tntd_invoice_counter');
  const invoiceNumber = `HD-TNTD-2026-${String(counter).padStart(4, '0')}`;
  const paidAt        = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  await kvSet(`order:${orderCode}`, JSON.stringify({
    ...order,
    status: 'paid',
    paidAt: Date.now(),
    invoiceNumber,
    transferAmount,
    transactionId: body.id || body.transactionId || null,
  }), 172800);

  // eInvoice
  let einvoiceData = null;
  try {
    const token = await getSepayEInvoiceToken();
    if (token) einvoiceData = await issueSepayEInvoice({ token, order, transferAmount });
  } catch (err) {
    console.error('[eInvoice] Exception:', err.message);
  }

  const ebookLink   = process.env.EBOOK_LINK || '#';
  const notifyEmail = process.env.NOTIFY_EMAIL;

  // Email 1: ebook cho khách
  try {
    await sendEmail({
      to: order.email,
      subject: `📖 Ebook của bạn đã sẵn sàng – Từ Nghèo Đến Tự Do [${orderCode}]`,
      html: `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><style>
body{font-family:'Segoe UI',Arial,sans-serif;background:#1A0F08;color:#F5E6C8;margin:0;padding:0}
.wrap{max-width:520px;margin:0 auto;padding:40px 24px}
.logo{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#F5E6C8;margin-bottom:4px}
.logo-sub{font-size:10px;letter-spacing:3px;color:#B8860B;text-transform:uppercase;margin-bottom:32px}
h1{font-family:Georgia,serif;font-size:24px;font-weight:300;margin-bottom:8px}
p{font-size:14px;color:rgba(245,230,200,0.65);line-height:1.7;margin-bottom:16px}
.btn{display:block;text-align:center;background:linear-gradient(135deg,#D4A030,#B8860B);color:#1A0F08;font-size:15px;font-weight:700;padding:16px 32px;border-radius:6px;text-decoration:none;margin:24px 0}
.box{background:rgba(255,255,255,0.04);border:1px solid rgba(184,134,11,0.2);border-radius:8px;padding:20px 24px;margin:24px 0}
.box p{color:rgba(245,230,200,0.55);margin:4px 0;font-size:13px}
.box strong{color:#F5E6C8}
.footer{margin-top:40px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(138,133,126,0.5);text-align:center}
</style></head><body><div class="wrap">
<div class="logo">Hanadola Media & Technology</div>
<div class="logo-sub">Tư Duy Đúng · Hành Động Đúng · Kết Quả Đúng</div>
<h1>Cảm ơn bạn, ${order.name}!</h1>
<p>Thanh toán đã được xác nhận. Ebook <strong>Từ Nghèo Đến Tự Do</strong> đã sẵn sàng để tải về.</p>
<a href="${ebookLink}" class="btn">📖 Tải Ebook Ngay</a>
<p style="font-size:12px;color:rgba(245,230,200,0.35)">Nếu nút trên không hoạt động: <a href="${ebookLink}" style="color:#B8860B">${ebookLink}</a></p>
<div class="box">
<p><strong>Mã đơn hàng:</strong> ${orderCode}</p>
<p><strong>Số hoá đơn:</strong> ${invoiceNumber}</p>
<p><strong>Sản phẩm:</strong> Ebook Từ Nghèo Đến Tự Do – PDF (30 bài học)</p>
<p><strong>Số tiền:</strong> ${(transferAmount || 149000).toLocaleString('vi-VN')} VND</p>
<p><strong>Thời gian:</strong> ${paidAt}</p>
</div>
<p>Link tải có hiệu lực vĩnh viễn. Cần hỗ trợ? Facebook: <a href="https://facebook.com/Tungheodentudo" style="color:#B8860B">Từ Nghèo Đến Tự Do</a></p>
<div class="footer">© 2026 HanaDola Media & Technology · Bảo lưu mọi quyền</div>
</div></body></html>`,
    });
  } catch (err) { console.error('[Email] Lỗi ebook:', err.message); }

  // Email 2: admin
  if (notifyEmail) {
    try {
      await sendEmail({
        to: notifyEmail,
        subject: `[TNTD] Đơn mới ${invoiceNumber} – ${(transferAmount || 149000).toLocaleString('vi-VN')}đ`,
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;padding:24px">
<h3 style="color:#B8860B">✅ Đơn hàng mới – Từ Nghèo Đến Tự Do</h3>
<p><strong>Hoá đơn:</strong> ${invoiceNumber}</p>
<p><strong>Mã đơn:</strong> ${orderCode}</p>
<p><strong>Khách hàng:</strong> ${order.name}</p>
<p><strong>Email:</strong> ${order.email}</p>
<p><strong>Số tiền:</strong> ${(transferAmount || 149000).toLocaleString('vi-VN')} VND</p>
<p><strong>Thời gian:</strong> ${paidAt}</p>
<p><strong>eInvoice:</strong> ${einvoiceData ? '✅ ' + einvoiceData.tracking_code : '⚠️ Chưa phát hành'}</p>
</div>`,
      });
    } catch (err) { console.error('[Email] Lỗi admin:', err.message); }
  }

  return res.status(200).json({ success: true, orderCode, invoiceNumber, einvoice: einvoiceData ? 'issued' : 'skipped' });
};
