// src/components/SeatMap.jsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

const SEAT_WIDTH = 8;
const SEAT_HEIGHT = 7;
const BACKREST_WIDTH = 6;
const BACKREST_HEIGHT = 3.5;
const HOLD_MINUTES = 10;

export default function SeatMap({ showId, userId }) {
  const [seats, setSeats] = useState([]);
  const [reservations, setReservations] = useState({});
  const [mySelections, setMySelections] = useState([]);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState('info');
  const [now, setNow] = useState(Date.now());
  const messageTimeoutRef = useRef(null);

  function showMessage(text, type = 'info', autoClearMs = 4000) {
    setMessage(text);
    setMessageType(type);
    if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    if (autoClearMs) {
      messageTimeoutRef.current = setTimeout(() => setMessage(null), autoClearMs);
    }
  }

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  async function fetchAllRows(query) {
    const pageSize = 1000;
    let from = 0;
    let all = [];
    while (true) {
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) throw error;
      all = all.concat(data || []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  async function loadData() {
    const seatData = await fetchAllRows(
      supabase.from('seats').select('*').eq('show_id', showId)
    );
    setSeats(seatData || []);

    const resData = await fetchAllRows(
      supabase
        .from('reservations')
        .select('seat_id, status, user_id, expires_at, checked_in')
        .eq('show_id', showId)
        .in('status', ['locked', 'confirmed'])
    );

    const map = {};
    (resData || []).forEach(r => {
      if (r.status === 'confirmed' || new Date(r.expires_at) > new Date()) {
        map[r.seat_id] = { status: r.status, user_id: r.user_id, expires_at: r.expires_at, checked_in: r.checked_in };
      }
    });
    setReservations(map);
    setMySelections(
      (resData || [])
        .filter(r => r.user_id === userId && r.status === 'locked' && new Date(r.expires_at) > new Date())
        .map(r => r.seat_id)
    );
  }

  useEffect(() => { loadData(); }, [showId, userId]);

  useEffect(() => {
    const channel = supabase
      .channel('seats-' + showId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reservations', filter: `show_id=eq.${showId}` },
        (payload) => {
          setReservations(prev => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE') {
              const wasMine = next[payload.old.seat_id]?.user_id === userId;
              delete next[payload.old.seat_id];
              if (wasMine) {
                showMessage('One of your held seats expired and was released.', 'info');
              }
            } else {
              const row = payload.new;
              if (row.status === 'confirmed' || new Date(row.expires_at) > new Date()) {
                next[row.seat_id] = { status: row.status, user_id: row.user_id, expires_at: row.expires_at, checked_in: row.checked_in };
              } else {
                delete next[row.seat_id];
              }
            }
            return next;
          });

          if (payload.eventType === 'DELETE') {
            setMySelections(prev => prev.filter(id => id !== payload.old.seat_id));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [showId, userId]);

  const seatStatus = useCallback((seatId) => {
    const r = reservations[seatId];
    if (!r) return 'available';
    if (r.status === 'confirmed') return r.checked_in ? 'checked_in' : 'confirmed';
    if (r.expires_at && new Date(r.expires_at).getTime() <= now) {
      return 'available';
    }
    if (r.user_id === userId) return 'mine';
    return 'locked';
  }, [reservations, userId, now]);

  useEffect(() => {
    setMySelections(prev =>
      prev.filter(id => {
        const r = reservations[id];
        return r && (!r.expires_at || new Date(r.expires_at).getTime() > now);
      })
    );
  }, [now, reservations]);

  async function handleSeatClick(seat) {
    const status = seatStatus(seat.id);
    if (status !== 'available') return;

    if (mySelections.length >= 4) {
      showMessage('You can only select up to 4 seats.', 'error');
      return;
    }

    const { data, error } = await supabase.rpc('lock_seat', {
      p_seat_id: seat.id,
      p_user_id: userId,
    });

    if (error || !data?.success) {
      const reason = data?.reason || 'error';
      showMessage(
        reason === 'seat_taken' ? 'That seat was just taken by someone else.' :
        reason === 'cap_reached' ? 'You already hold 4 seats.' :
        'Could not select that seat. Please try again.',
        'error'
      );
      return;
    }

    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();
    setMySelections(prev => [...prev, seat.id]);
    setReservations(prev => ({ ...prev, [seat.id]: { status: 'locked', user_id: userId, expires_at: expiresAt } }));
    showMessage(null);
  }

  async function handleRelease(seatId) {
    const { data, error } = await supabase.rpc('release_own_lock', {
      p_seat_id: seatId,
      p_user_id: userId,
    });

    if (error || !data?.success) {
      showMessage('Could not remove that seat. Please try again.', 'error');
      return;
    }

    setMySelections(prev => prev.filter(id => id !== seatId));
    setReservations(prev => {
      const next = { ...prev };
      delete next[seatId];
      return next;
    });
  }

  async function handleConfirm() {
    const { data, error } = await supabase.rpc('confirm_reservation', {
      p_user_id: userId,
      p_show_id: showId,
    });

    if (error || !data?.success) {
      showMessage(
        'Could not confirm — your hold(s) may have expired. Please reselect your seats.',
        'error'
      );
      await loadData();
      return;
    }

    showMessage(`Booked ${data.confirmed_count} seat(s)!`, 'success');
    setMySelections([]);
    await loadData();

    // Fire-and-forget: email sending shouldn't block or fail the booking itself.
    supabase.functions.invoke('send-confirmation-email', { body: { showId } })
      .catch(() => { /* booking already succeeded; a failed email isn't fatal */ });
  }

  // CSS variables carry the actual colors, defined in theme.css
  const glow = {
    available: { fill: 'var(--available)' },
    locked: { fill: 'var(--spotlight)' },
    mine: { fill: 'var(--stage-glow)' },
    confirmed: { fill: 'var(--taken)' },
    checked_in: { fill: 'var(--success)' },
  };

  const soonestExpiry = mySelections
    .map(id => reservations[id]?.expires_at)
    .filter(Boolean)
    .map(e => new Date(e).getTime())
    .sort((a, b) => a - b)[0];

  const secondsLeft = soonestExpiry ? Math.max(0, Math.floor((soonestExpiry - now) / 1000)) : null;
  const showExpiryWarning = secondsLeft !== null && secondsLeft <= 60;

  return (
    <div className="seat-map-wrap">
      <h2 className="section-heading" style={{ textAlign: 'center' }}>C4 Building</h2>
      <div className="stage-bar">
        <span className="stage-label">STAGE</span>
      </div>

      {showExpiryWarning && (
        <p className="expiry-warning">
          Your held seat(s) expire in {secondsLeft}s — confirm soon!
        </p>
      )}

      <svg viewBox="-70 50 1140 405" style={{ width: '100%', maxWidth: 900, display: 'block', margin: '0 auto' }}>
        {seats.map(seat => {
          const status = seatStatus(seat.id);
          const atCap = mySelections.length >= 4;
          const clickable = status === 'available' && !atCap;
          const style = glow[status];
          const label = `Seat ${seat.section}${seat.seat_number} — ${
            status === 'checked_in' ? 'checked in' :
            status === 'available' && atCap ? 'available, but selection limit reached' :
            status
          }`;
          return (
            <g
              key={seat.id}
              className={`seat-dot ${clickable ? 'clickable' : ''}`}
              style={{ cursor: clickable ? 'pointer' : 'not-allowed' }}
              onClick={() => clickable && handleSeatClick(seat)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && clickable) {
                  e.preventDefault();
                  handleSeatClick(seat);
                }
              }}
              role="button"
              tabIndex={clickable ? 0 : -1}
              aria-label={label}
              aria-disabled={!clickable}
            >
              <title>{label}</title>
              {/* backrest */}
              <rect
                x={seat.pos_x - BACKREST_WIDTH / 2}
                y={seat.pos_y - SEAT_HEIGHT / 2 - BACKREST_HEIGHT + 1.5}
                width={BACKREST_WIDTH}
                height={BACKREST_HEIGHT}
                rx={1.5}
                fill={style.fill}
              />
              {/* seat cushion */}
              <rect
                x={seat.pos_x - SEAT_WIDTH / 2}
                y={seat.pos_y - SEAT_HEIGHT / 2}
                width={SEAT_WIDTH}
                height={SEAT_HEIGHT}
                rx={2}
                fill={style.fill}
              />
            </g>
          );
        })}
      </svg>

      <div className="legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--available)' }} />Available</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--spotlight)' }} />Held by others</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--stage-glow)' }} />Held by you</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--taken)' }} />Booked</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--success)' }} />Checked in</span>
      </div>

      {message && (
        <p className={`message-banner message-${messageType}`} role="status" aria-live="polite">{message}</p>
      )}

      <div className="selection-panel">
        <p className="selection-count">
          {mySelections.length} of 4 seats selected
          {mySelections.length >= 4 && ' — limit reached'}
        </p>

        {mySelections.length > 0 && (
          <ul className="selection-list">
            {mySelections.map(id => {
              const seat = seats.find(s => s.id === id);
              if (!seat) return null;
              return (
                <li key={id} className="selection-item">
                  <span>Seat {seat.section}{seat.seat_number}</span>
                  <button className="btn-text" onClick={() => handleRelease(id)}>Remove</button>
                </li>
              );
            })}
          </ul>
        )}

        <button className="btn btn-primary" disabled={mySelections.length === 0} onClick={handleConfirm}>
          Confirm booking
        </button>
      </div>
    </div>
  );
}