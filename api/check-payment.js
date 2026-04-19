// api/check-payment.js — Tu Ngheo Den Tu Do
// CommonJS – fetch thuần, không npm packages

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.query;
  if (!code || !/^TNTD[A-Z0-9]{4}$/i.test(code)) {
    return res.status(400).json({ error: 'Mã đơn hàng không hợp lệ' });
  }

  const r = await fetch(
    `${process.env.KV_REST_API_URL}/get/${encodeURIComponent('order:' + code.toUpperCase())}`,
    { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` } }
  );
  const d = await r.json();

  if (!d.result) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

  const order = typeof d.result === 'string' ? JSON.parse(d.result) : d.result;

  if (order.status === 'paid') {
    return res.status(200).json({
      paid: true,
      orderCode: order.orderCode,
      ebookLink: process.env.EBOOK_LINK || null,
    });
  }

  return res.status(200).json({
    paid: false,
    orderCode: order.orderCode,
    status: order.status,
  });
};
