// supabase/functions/send-reminder-emails/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const EVENT_NAME = 'MFU Band Concert 2026'; // update to your real event name
const EVENT_DATE = 'Sunday, August 30, 2026 · 7:30 PM'; // update to your real date
const VENUE = 'C4 Building';
const SITE_URL = 'https://mfu-concert-blush.vercel.app/'; // update once deployed

// Keep each batch small enough to comfortably finish well within an Edge
// Function's execution time limit, even if some sends are slow.
const BATCH_SIZE = 40;

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

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userData.user.id)
      .single();

    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: 'not_authorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cross-user reads (everyone's bookings + auth email lookups) need the
    // service role client — RLS + the caller's own token can't do this.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: reservations, error: resError } = await supabaseAdmin
      .from('reservations')
      .select('user_id, seats(section, row_number, seat_number)')
      .eq('show_id', showId)
      .eq('status', 'confirmed');

    if (resError) {
      return new Response(JSON.stringify({ error: 'query_failed', detail: resError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!reservations || reservations.length === 0) {
      return new Response(JSON.stringify({ error: 'no_confirmed_bookings' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group all confirmed seats by user, so each person gets ONE email listing
    // every seat they hold, not one email per seat.
    const seatsByUser = new Map<string, { section: string; row_number: number; seat_number: number }[]>();
    for (const r of reservations) {
      if (!r.user_id || !r.seats) continue;
      if (!seatsByUser.has(r.user_id)) seatsByUser.set(r.user_id, []);
      seatsByUser.get(r.user_id)!.push(r.seats as any);
    }

    const totalUserCount = seatsByUser.size;

    // Find who's already been sent a reminder for this show, so repeated
    // batch calls never double-email anyone.
    const { data: alreadySent } = await supabaseAdmin
      .from('reminder_log')
      .select('user_id')
      .eq('show_id', showId);

    const alreadySentSet = new Set((alreadySent || []).map(r => r.user_id));
    const pendingUserIds = [...seatsByUser.keys()].filter(uid => !alreadySentSet.has(uid));

    if (pendingUserIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sentCount: 0, failedCount: 0, remaining: 0, totalUserCount, alreadyDone: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const batchUserIds = pendingUserIds.slice(0, BATCH_SIZE);

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

    let sentCount = 0;
    let failedCount = 0;

    try {
      for (const userId of batchUserIds) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
        const email = authUser?.user?.email;
        if (!email) {
          failedCount++;
          continue;
        }

        const userSeats = seatsByUser.get(userId)!;
        const sortedSeats = userSeats.sort((a, b) => {
          if (a.section !== b.section) return a.section.localeCompare(b.section);
          if (a.row_number !== b.row_number) return a.row_number - b.row_number;
          return a.seat_number - b.seat_number;
        });
        const seatLabels = sortedSeats.map(s => `${s.section}${s.row_number}-${s.seat_number}`);
        const seatListHtml = seatLabels.map(s => `<li style="margin-bottom:4px;">${s}</li>`).join('');

        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #18181b;">
            <h2 style="margin-bottom: 4px;">${EVENT_NAME}</h2>
            <p style="color:#71717a; margin-top:0;">${EVENT_DATE} &middot; ${VENUE}</p>
            <p>This is a friendly reminder about your upcoming booking! Here are your seat(s):</p>
            <ul style="padding-left: 20px;">${seatListHtml}</ul>
            <p>Please arrive a little early and have your QR ticket (in "My Bookings" on the site) ready to show at entry.</p>
            <p style="margin-top: 24px;">
              <a href="${SITE_URL}" style="background:#635bff; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none;">
                View my tickets
              </a>
            </p>
          </div>
        `;

        try {
          await client.send({
            from: Deno.env.get('GMAIL_USER')!,
            to: email,
            subject: `Reminder — ${EVENT_NAME}`,
            html: emailHtml,
          });
          sentCount++;
          // Mark as sent immediately after each success, so a crash partway
          // through a batch never causes a duplicate send on retry.
          await supabaseAdmin.from('reminder_log').insert({ show_id: showId, user_id: userId });
        } catch {
          failedCount++;
        }
      }
    } finally {
      await client.close();
    }

    const remaining = pendingUserIds.length - batchUserIds.length;

    return new Response(
      JSON.stringify({ success: true, sentCount, failedCount, remaining, totalUserCount }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: 'unexpected_error', detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});