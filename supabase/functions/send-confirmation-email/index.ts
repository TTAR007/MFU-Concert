// supabase/functions/send-confirmation-email/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const EVENT_NAME = 'MFU Band Concert 2026'; // update to your real event name
const EVENT_DATE = 'Sunday, August 30, 2026 · 7:30 PM'; // update to your real date
const VENUE = 'C4 Building';
const SITE_URL = 'https://mfu-concert-blush.vercel.app'; // update once deployed

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
 
// Email subject headers require RFC 2047 "encoded-word" syntax for any non-ASCII
// text (like Thai) — without it, mail servers/clients show the raw UTF-8 bytes
// as literal "=E0=B8=81..." text instead of decoding them properly.
function encodeSubject(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  const base64 = btoa(binary);
  return `=?UTF-8?B?${base64}?=`;
}
 
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
 
  try {
    const { showId } = await req.json();
    if (!showId) {
      return new Response(JSON.stringify({ error: 'missing_show_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
 
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'not_authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
 
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
 
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'not_authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const user = userData.user;
 
    const { data: reservations, error: resError } = await supabase
      .from('reservations')
      .select('seats(section, row_number, seat_number)')
      .eq('show_id', showId)
      .eq('user_id', user.id)
      .eq('status', 'confirmed');
 
    if (resError) {
      return new Response(JSON.stringify({ error: 'query_failed', detail: resError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!reservations || reservations.length === 0) {
      return new Response(JSON.stringify({ error: 'no_confirmed_seats' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
 
    const seats = reservations
      .map(r => r.seats)
      .sort((a, b) => {
        if (a.section !== b.section) return a.section.localeCompare(b.section);
        if (a.row_number !== b.row_number) return a.row_number - b.row_number;
        return a.seat_number - b.seat_number;
      });
 
    const seatCount = seats.length;
    const seatWord = seatCount === 1 ? 'seat' : 'seats';
 
    const seatRowsHtml = seats
      .map(
        s => `
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #2A2A2A;font-size:15px;color:#F5F5F5;font-weight:600;">${s.section}${s.row_number}-${s.seat_number}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #2A2A2A;font-size:13px;color:#9A9A9A;">Zone ${s.section} · Row ${s.row_number} · Seat ${s.seat_number}<br/>โซน ${s.section} · แถว ${s.row_number} · ที่นั่ง ${s.seat_number}</td>
          </tr>`
      )
      .join('');
 
    const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Booking Confirmed</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0F;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:480px;background:#14161C;border:1px solid #23232E;border-radius:14px;overflow:hidden;">
 
          <tr>
            <td style="background:linear-gradient(135deg,#6366F1,#818CF8);padding:28px 28px 22px;text-align:center;">
              <div style="font-size:13px;letter-spacing:0.08em;color:rgba(255,255,255,0.85);text-transform:uppercase;font-weight:600;margin-bottom:6px;">
                Booking Confirmed &nbsp;·&nbsp; ยืนยันการจองแล้ว
              </div>
              <div style="font-size:22px;font-weight:700;color:#ffffff;">${EVENT_NAME}</div>
            </td>
          </tr>
 
          <tr>
            <td style="padding:26px 28px 10px;">
              <p style="margin:0 0 6px;font-size:15px;color:#F5F5F5;line-height:1.6;">
                Hi there — your booking for <strong>${seatCount} ${seatWord}</strong> is confirmed. Here are your seat details:
              </p>
              <p style="margin:0;font-size:13px;color:#9A9A9A;line-height:1.6;">
                สวัสดีค่ะ/ครับ การจอง <strong>${seatCount} ที่นั่ง</strong> ของคุณได้รับการยืนยันแล้ว รายละเอียดที่นั่งมีดังนี้
              </p>
            </td>
          </tr>
 
          <tr>
            <td style="padding:12px 14px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1B1E27;border-radius:10px;overflow:hidden;">
                ${seatRowsHtml}
              </table>
            </td>
          </tr>
 
          <tr>
            <td style="padding:22px 28px 6px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#9A9A9A;width:90px;vertical-align:top;">Date<br/>วันที่</td>
                  <td style="padding:6px 0;font-size:14px;color:#F5F5F5;">${EVENT_DATE}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#9A9A9A;width:90px;vertical-align:top;">Venue<br/>สถานที่</td>
                  <td style="padding:6px 0;font-size:14px;color:#F5F5F5;">${VENUE}</td>
                </tr>
              </table>
            </td>
          </tr>
 
          <tr>
            <td style="padding:20px 28px 6px;text-align:center;">
              <a href="${SITE_URL}" style="display:inline-block;background:#6366F1;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 28px;border-radius:10px;">
                View my ticket &nbsp;/&nbsp; ดูตั๋วของฉัน
              </a>
            </td>
          </tr>
 
          <tr>
            <td style="padding:20px 28px 4px;">
              <div style="border-top:1px solid #23232E;padding-top:16px;">
                <p style="margin:0 0 8px;font-size:13px;color:#B8B8C0;line-height:1.7;">
                  Please arrive a little early and have your QR ticket ready to show at entry — you'll find it any time in <strong style="color:#F5F5F5;">My Bookings</strong>.
                </p>
                <p style="margin:0;font-size:12px;color:#8A8A93;line-height:1.7;">
                  กรุณามาถึงก่อนเวลาเล็กน้อย และเตรียม QR โค้ดของคุณไว้แสดงที่ทางเข้า — คุณสามารถดูได้ตลอดเวลาในหน้า <strong style="color:#B8B8C0;">การจองของฉัน</strong>
                </p>
              </div>
            </td>
          </tr>
 
          <tr>
            <td style="padding:22px 28px 26px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#5A5A63;">
                See you there! &nbsp;·&nbsp; แล้วพบกันนะคะ/ครับ
              </p>
            </td>
          </tr>
 
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
 
    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: {
          username: Deno.env.get('GMAIL_USER')!,
          password: Deno.env.get('GMAIL_APP_PASSWORD')!,
        },
      },
    });
 
    try {
      await client.send({
        from: `${EVENT_NAME} <${Deno.env.get('GMAIL_USER')!}>`,
        to: user.email!,
        subject: encodeSubject(`Booking Confirmed / ยืนยันการจอง — ${EVENT_NAME}`),
        html: emailHtml,
      });
    } finally {
      await client.close();
    }
 
    return new Response(JSON.stringify({ success: true, seatCount }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'unexpected_error', detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});