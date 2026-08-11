// src/components/MyBookings.jsx
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabaseClient';
import { useLanguage } from '../i18n';

// Must match the seat shape constants in SeatMap.jsx exactly, so the mini-map
// here renders visually identical seats to the main seat selection view.
const SEAT_WIDTH = 8;
const SEAT_HEIGHT = 7;
const BACKREST_WIDTH = 6;
const BACKREST_HEIGHT = 3.5;

export default function MyBookings({ showId, userId }) {
  const { t } = useLanguage();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTicket, setActiveTicket] = useState(null); // the booking object currently shown in overlay
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [zoneMapSeats, setZoneMapSeats] = useState([]);
  const [zoneMapLoading, setZoneMapLoading] = useState(false);
  const closeButtonRef = useRef(null);
  const lastTriggerRef = useRef(null);

  async function loadBookings() {
    setLoading(true);
    const { data, error } = await supabase
      .from('reservations')
      .select('id, seat_id, ticket_code, checked_in, seats(section, row_number, seat_number, pos_x, pos_y)')
      .eq('show_id', showId)
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: true });

    if (!error) {
      const sorted = (data || []).sort((a, b) => {
        if (a.seats.section !== b.seats.section) {
          return a.seats.section.localeCompare(b.seats.section);
        }
        if (a.seats.row_number !== b.seats.row_number) {
          return a.seats.row_number - b.seats.row_number;
        }
        return a.seats.seat_number - b.seats.seat_number;
      });
      setBookings(sorted);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadBookings();
  }, [showId, userId]);

  // Live-update check-in status the instant an admin scans this user's ticket —
  // no manual refresh needed while My Bookings is open.
  useEffect(() => {
    if (!showId || !userId) return;

    const channel = supabase
      .channel(`my-bookings-checkin-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'reservations',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new;
          if (updated.show_id !== showId) return;

          setBookings(prev =>
            prev.map(b =>
              b.id === updated.id ? { ...b, checked_in: updated.checked_in } : b
            )
          );

          // Keep the open ticket modal in sync too, if it's the one that just got scanned.
          setActiveTicket(prev =>
            prev && prev.id === updated.id ? { ...prev, checked_in: updated.checked_in } : prev
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [showId, userId]);

  async function openTicket(b, triggerEl) {
    lastTriggerRef.current = triggerEl;
    setActiveTicket(b);
    setConfirmingCancel(false);
    setZoneMapSeats([]);
    setZoneMapLoading(true);

    const { data } = await supabase
      .from('seats')
      .select('id, row_number, pos_x, pos_y')
      .eq('show_id', showId)
      .eq('section', b.seats.section);

    setZoneMapSeats(data || []);
    setZoneMapLoading(false);
  }

  const closeTicket = useCallback(() => {
    setActiveTicket(null);
    setConfirmingCancel(false);
    lastTriggerRef.current?.focus();
  }, []);

  async function handleCancelBooking() {
    if (!activeTicket) return;
    setCancelling(true);
    const { data, error } = await supabase.rpc('cancel_own_reservation', {
      p_seat_id: activeTicket.seat_id,
      p_user_id: userId,
    });
    setCancelling(false);

    if (error || !data?.success) {
      setConfirmingCancel(false);
      return;
    }

    setActiveTicket(null);
    setConfirmingCancel(false);
    loadBookings();
  }

  const findSeatViewBox = useMemo(() => {
    if (zoneMapSeats.length === 0) return '0 0 100 100';
    const xs = zoneMapSeats.map(s => s.pos_x);
    const ys = zoneMapSeats.map(s => s.pos_y);
    const pad = 15;
    const minX = Math.min(...xs) - pad - 10; // extra room on the left for row labels
    const minY = Math.min(...ys) - pad;
    const width = Math.max(...xs) - Math.min(...xs) + pad * 2 + 10;
    const height = Math.max(...ys) - Math.min(...ys) + pad * 2;
    return `${minX} ${minY} ${width} ${height}`;
  }, [zoneMapSeats]);

  const findSeatRowLabels = useMemo(() => {
    if (zoneMapSeats.length === 0) return [];
    const rows = {};
    zoneMapSeats.forEach(s => {
      if (!rows[s.row_number] || s.pos_x < rows[s.row_number].pos_x) {
        rows[s.row_number] = s;
      }
    });
    return Object.entries(rows).map(([rowNumber, leftmostSeat]) => ({
      rowNumber,
      x: leftmostSeat.pos_x - 9,
      y: leftmostSeat.pos_y,
    }));
  }, [zoneMapSeats]);

  // Focus the close button when the modal opens; close on Escape
  useEffect(() => {
    if (!activeTicket) return;
    closeButtonRef.current?.focus();

    function handleKeyDown(e) {
      if (e.key === 'Escape') closeTicket();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeTicket, closeTicket]);

  if (loading) return <p className="empty-state">{t('loadingBookings')}</p>;

  if (bookings.length === 0) {
    return <p className="empty-state">{t('noBookingsYetFull')}</p>;
  }

  return (
    <div>
      <h2 className="section-heading">{t('yourSeats')}</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        {t('tapTicketHint')}
      </p>
      <ul className="bookings-list">
        {bookings.map(b => (
          <li
            key={b.id}
            className={`ticket-stub ${b.checked_in ? 'ticket-stub-checked-in' : ''}`}
            onClick={(e) => openTicket(b, e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openTicket(b, e.currentTarget);
              }
            }}
            role="button"
            tabIndex={0}
            style={{ cursor: 'pointer' }}
          >
            <div className="ticket-stub-main">
              <span className="ticket-stub-eyebrow">{t('seat').toUpperCase()}</span>
              <span className="ticket-stub-number">{b.seats.section}{b.seats.row_number}-{b.seats.seat_number}</span>
              {b.checked_in && <span className="status-badge status-checked-in" style={{ marginTop: 4, alignSelf: 'flex-start' }}>{t('checkedIn')}</span>}
            </div>
            <div className="ticket-stub-perforation" aria-hidden="true">
              <span className="ticket-stub-notch ticket-stub-notch-top" />
              <span className="ticket-stub-notch ticket-stub-notch-bottom" />
            </div>
            <div className="ticket-stub-view" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" />
              </svg>
              <span className="ticket-stub-view-label">{t('view')}</span>
            </div>
          </li>
        ))}
      </ul>

      {activeTicket && (
        <div className="ticket-overlay" onClick={closeTicket}>
          <div
            className="ticket-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticket-modal-heading"
          >
            <button
              ref={closeButtonRef}
              className="ticket-modal-close"
              onClick={closeTicket}
              aria-label="Close ticket"
            >
              ✕
            </button>
            <div className="ticket-modal-content">
              <p id="ticket-modal-heading" className="section-heading" style={{ marginBottom: 4 }}>
                {t('seat')} {activeTicket.seats.section}{activeTicket.seats.row_number}-{activeTicket.seats.seat_number}
              </p>
              <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 12 }}>
                {t('zone')} {activeTicket.seats.section} &middot; {t('row')} {activeTicket.seats.row_number} &middot; {t('seat')} {activeTicket.seats.seat_number}
              </p>

              {!zoneMapLoading && zoneMapSeats.length > 0 && (
                <div className="find-seat-map">
                  <svg viewBox={findSeatViewBox} className="find-seat-svg" aria-hidden="true">
                    {findSeatRowLabels.map(rl => (
                      <text
                        key={rl.rowNumber}
                        x={rl.x}
                        y={rl.y}
                        className="row-label find-seat-row-label"
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        {rl.rowNumber}
                      </text>
                    ))}
                    {zoneMapSeats.map(s => {
                      const isTarget = s.id === activeTicket.seat_id;
                      const fill = isTarget ? 'var(--accent)' : 'var(--border)';
                      return (
                        <g key={s.id} className={isTarget ? 'find-seat-highlight' : ''}>
                          {/* backrest */}
                          <rect
                            x={s.pos_x - BACKREST_WIDTH / 2}
                            y={s.pos_y - SEAT_HEIGHT / 2 - BACKREST_HEIGHT + 1.5}
                            width={BACKREST_WIDTH}
                            height={BACKREST_HEIGHT}
                            fill={fill}
                          />
                          {/* seat */}
                          <rect
                            x={s.pos_x - SEAT_WIDTH / 2}
                            y={s.pos_y - SEAT_HEIGHT / 2}
                            width={SEAT_WIDTH}
                            height={SEAT_HEIGHT}
                            fill={fill}
                          />
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}

              {activeTicket.ticket_code && (
                <div className={`ticket-qr-large ${activeTicket.checked_in ? 'ticket-qr-checked-in' : ''}`}>
                  <QRCodeSVG value={activeTicket.ticket_code} size={220} bgColor="#ffffff" fgColor="#000000" />
                  {activeTicket.checked_in && (
                    <span className="status-badge status-checked-in qr-checked-in-badge">{t('checkedIn')}</span>
                  )}
                </div>
              )}
              <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 12, marginBottom: 16 }}>
                {t('showAtEntry')}
              </p>

              {!confirmingCancel ? (
                <button className="btn-text" style={{ color: 'var(--taken)' }} onClick={() => setConfirmingCancel(true)}>
                  {t('cancelBooking')}
                </button>
              ) : (
                <div>
                  <p style={{ fontSize: 13, marginBottom: 8 }}>{t('cancelConfirmText')}</p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button className="btn" onClick={() => setConfirmingCancel(false)} disabled={cancelling}>
                      {t('keepIt')}
                    </button>
                    <button
                      className="btn"
                      style={{ background: 'var(--taken)', color: '#fff', borderColor: 'var(--taken)' }}
                      onClick={handleCancelBooking}
                      disabled={cancelling}
                    >
                      {cancelling ? t('cancelling') : t('yesCancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}