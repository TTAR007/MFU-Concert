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

    const seatListHtml = seatLabels.map(s => `
      <span style="display: inline-block; background-color: #f4f4f5; color: #27272a; padding: 6px 12px; border-radius: 6px; font-size: 14px; font-weight: 600; margin-right: 6px; margin-bottom: 6px; border: 1px solid #e4e4e7;">
        ${s}
      </span>
    `).join('');

    const emailHtml = `
      <div style="background-color: #f9fafb; padding: 40px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #18181b;">
        <div style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e4e4e7; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Header Banner Accent -->
          <div style="background: linear-gradient(135deg, #635bff 0%, #4f46e5 100%); padding: 24px 32px; color: #ffffff;">
            <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700; opacity: 0.85;">Booking Confirmed</p>
            <h2 style="margin: 6px 0 0 0; font-size: 24px; font-weight: 700; line-height: 1.2;">${EVENT_NAME}</h2>
          </div>

          <!-- Body Content -->
          <div style="padding: 32px;">
            <div style="margin-bottom: 24px; border-bottom: 1px solid #f4f4f5; padding-bottom: 16px;">
              <p style="margin: 0; color: #71717a; font-size: 14px; font-weight: 500;">
                ${EVENT_DATE} &middot; <strong style="color: #27272a;">${VENUE}</strong>
              </p>
            </div>

            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.5; color: #3f3f46;">
              You're all set! We've secured your spot. Here are your reserved seats:
            </p>

            <!-- Seat Badges Container -->
            <div style="margin-bottom: 24px;">
              ${seatListHtml}
            </div>

            <!-- Instruction Box -->
            <div style="background-color: #f8fafc; border-left: 3px solid #635bff; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 28px;">
              <p style="margin: 0; font-size: 14px; color: #475569; line-height: 1.4;">
                Show your QR ticket (found under <strong>"My Bookings"</strong> on the site) at the venue entry.
              </p>
            </div>

            <!-- Action Button -->
            <div style="text-align: left;">
              <a href="${SITE_URL}" style="display: inline-block; background-color: #635bff; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; box-shadow: 0 2px 4px rgba(99, 91, 255, 0.2);">
                View my tickets &rarr;
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="background-color: #f9fafb; padding: 16px 32px; border-top: 1px solid #f4f4f5; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
              If you have any questions, reach out to our support team.
            </p>
          </div>

        </div>
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