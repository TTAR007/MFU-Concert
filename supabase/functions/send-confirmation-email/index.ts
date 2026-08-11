// supabase/functions/send-confirmation-email/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const EVENT_NAME = 'MFU Band Concert 2026'; // update to your real event name
const EVENT_DATE = 'Sunday, August 30, 2026 · 7:30 PM'; // update to your real date
const VENUE = 'C4 Building';
const SITE_URL = 'https://mfu-concert-blush.vercel.app/'; // update once deployed

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
      .select('seats(section, seat_number, row_number)')
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

    const seatLabels = reservations
      .map(r => `${r.seats.section}${r.seats.row_number}-${r.seats.seat_number}`)
      .sort();

    const seatListHtml = seatLabels.map(s => `<li style="margin-bottom:4px;">${s}</li>`).join('');

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #18181b;">
        <h2 style="margin-bottom: 4px;">${EVENT_NAME}</h2>
        <p style="color:#71717a; margin-top:0;">${EVENT_DATE} &middot; ${VENUE}</p>
        <p>Your booking is confirmed! Here are your seat(s):</p>
        <ul style="padding-left: 20px;">${seatListHtml}</ul>
        <p>Show your QR ticket (in "My Bookings" on the site) at entry.</p>
        <p style="margin-top: 24px;">
          <a href="${SITE_URL}" style="background:#635bff; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none;">
            View my tickets
          </a>
        </p>
      </div>
    `;

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
        from: Deno.env.get('GMAIL_USER')!,
        to: user.email!,
        subject: `Booking confirmed — ${EVENT_NAME}`,
        html: emailHtml,
      });
    } finally {
      await client.close();
    }

    return new Response(JSON.stringify({ success: true, seatCount: seatLabels.length }), {
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