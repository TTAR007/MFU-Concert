// src/components/MyBookings.jsx
import { useEffect, useState, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabaseClient';

export default function MyBookings({ showId, userId }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTicket, setActiveTicket] = useState(null); // the booking object currently shown in overlay
  const closeButtonRef = useRef(null);
  const lastTriggerRef = useRef(null);

  useEffect(() => {
    async function load() {
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
    load();
  }, [showId, userId]);

  function openTicket(b, triggerEl) {
    lastTriggerRef.current = triggerEl;
    setActiveTicket(b);
  }

  const closeTicket = useCallback(() => {
    setActiveTicket(null);
    lastTriggerRef.current?.focus();
  }, []);

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
            className={`booking-item ticket-item ${b.checked_in ? 'ticket-checked-in' : ''}`}
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
            <span>Seat {b.seats.section}{b.seats.seat_number}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {b.checked_in && <span className="status-badge status-checked-in">Checked in</span>}
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Tap to show ticket</span>
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
            <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 12 }}>
              Show this at entry
            </p>
          </div>
        </div>
      )}
    </div>
  );
}