// src/components/MyBookings.jsx
import { useEffect, useState, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabaseClient';

export default function MyBookings({ showId, userId }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTicket, setActiveTicket] = useState(null); // the booking object currently shown in overlay
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const closeButtonRef = useRef(null);
  const lastTriggerRef = useRef(null);

  async function loadBookings() {
    setLoading(true);
    const { data, error } = await supabase
      .from('reservations')
      .select('id, seat_id, ticket_code, checked_in, seats(section, seat_number)')
      .eq('show_id', showId)
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: true });

    if (!error) {
      const sorted = (data || []).sort((a, b) => {
        if (a.seats.section !== b.seats.section) {
          return a.seats.section.localeCompare(b.seats.section);
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

  function openTicket(b, triggerEl) {
    lastTriggerRef.current = triggerEl;
    setActiveTicket(b);
    setConfirmingCancel(false);
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

  if (loading) return <p className="empty-state">Loading your bookings...</p>;

  if (bookings.length === 0) {
    return <p className="empty-state">No confirmed seats yet. Head to the Seat Map to grab one.</p>;
  }

  return (
    <div>
      <h2 className="section-heading">Your seats</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Tap a ticket to show its QR code at entry.
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
              <span className="ticket-stub-eyebrow">SEAT</span>
              <span className="ticket-stub-number">{b.seats.section}{b.seats.seat_number}</span>
              {b.checked_in && <span className="status-badge status-checked-in" style={{ marginTop: 4, alignSelf: 'flex-start' }}>Checked in</span>}
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
              <span className="ticket-stub-view-label">View</span>
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
            <p id="ticket-modal-heading" className="section-heading" style={{ marginBottom: 4 }}>
              Seat {activeTicket.seats.section}{activeTicket.seats.seat_number}
            </p>
            {activeTicket.checked_in && (
              <p style={{ marginBottom: 12 }}>
                <span className="status-badge status-checked-in">Checked in</span>
              </p>
            )}
            {activeTicket.ticket_code && (
              <div className="ticket-qr-large">
                <QRCodeSVG value={activeTicket.ticket_code} size={220} bgColor="#ffffff" fgColor="#000000" />
              </div>
            )}
            <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 12, marginBottom: 16 }}>
              Show this at entry
            </p>

            {!confirmingCancel ? (
              <button className="btn-text" style={{ color: 'var(--taken)' }} onClick={() => setConfirmingCancel(true)}>
                Cancel booking
              </button>
            ) : (
              <div>
                <p style={{ fontSize: 13, marginBottom: 8 }}>Cancel this seat? This can't be undone.</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button className="btn" onClick={() => setConfirmingCancel(false)} disabled={cancelling}>
                    Keep it
                  </button>
                  <button
                    className="btn"
                    style={{ background: 'var(--taken)', color: '#fff', borderColor: 'var(--taken)' }}
                    onClick={handleCancelBooking}
                    disabled={cancelling}
                  >
                    {cancelling ? 'Cancelling…' : 'Yes, cancel'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}