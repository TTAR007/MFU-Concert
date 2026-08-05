// supabase/functions/send-confirmation-email/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EVENT_NAME = 'Your Concert Name';
const EVENT_DATE = 'Saturday, September 15, 2026 · 7:00 PM'; // update to your real date
const VENUE = 'C4 Building';
const RESEND_FROM = 'onboarding@resend.dev'; // switch to your verified domain sender later
const SITE_URL = 'https://your-deployed-site-url.example.com'; // update once deployed

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // Browsers send an OPTIONS preflight request before the real POST — must respond OK, not process it as data.
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

    // Client scoped to the calling user's own JWT — respects RLS,
    // so this can only ever read the caller's own reservations.
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
      .select('seats(section, seat_number)')
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
      .map(r => `${r.seats.section}${r.seats.seat_number}`)
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

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: user.email,
        subject: `Booking confirmed — ${EVENT_NAME}`,
        html: emailHtml,
      }),
    });

    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      return new Response(JSON.stringify({ error: 'email_send_failed', detail: errText }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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