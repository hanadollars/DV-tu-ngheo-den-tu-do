// api/create-order.js — Tu Ngheo Den Tu Do
// CommonJS – fetch thuần, không npm packages

const AMOUNT = 149000;

function generateOrderCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return 'TNTD' + s;
}

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
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SET', key, value, 'EX', ex]),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Thiếu thông tin name/email' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email không hợp lệ' });

  const acbAccount  = process.env.ACB_ACCOUNT  || '20176968';
  const accountName = process.env.ACCOUNT_NAME || 'Cong ty TNHH Hanadola Media & Technology';

  let orderCode;
  let attempts = 0;
  do {
    orderCode = generateOrderCode();
    const existing = await kvGet(`order:${orderCode}`);
    if (!existing) break;
    attempts++;
  } while (attempts < 5);

  const orderData = {
    orderCode,
    name,
    email,
    amount: AMOUNT,
    status: 'pending',
    createdAt: Date.now(),
  };

  await kvSet(`order:${orderCode}`, JSON.stringify(orderData), 172800);

  const qrUrl =
    `https://img.vietqr.io/image/970416-${acbAccount}-compact2.png` +
    `?amount=${AMOUNT}&addInfo=${encodeURIComponent(orderCode)}&accountName=${encodeURIComponent(accountName)}`;

  return res.status(200).json({
    orderCode,
    qrUrl,
    amount: AMOUNT,
    accountNumber: acbAccount,
    accountName,
  });
};
