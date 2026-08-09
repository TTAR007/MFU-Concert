// src/components/AdminView.jsx
import { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useLanguage } from '../i18n';

export default function AdminView({ showId, adminId }) {
  const { t } = useLanguage();
  const [seats, setSeats] = useState([]);
  const [reservations, setReservations] = useState({});
  const [message, setMessage] = useState(null);
  const messageTimeoutRef = useRef(null);
  const [toastPos, setToastPos] = useState({ top: '50%', left: '50%' });
  const [viewingSeatId, setViewingSeatId] = useState(null);

  // Group already-loaded seats by zone for the mini-map — no extra fetch needed.
  const seatsByZone = useMemo(() => {
    const groups = {};
    seats.forEach(s => {
      if (!groups[s.section]) groups[s.section] = [];
      groups[s.section].push(s);
    });
    return groups;
  }, [seats]);

  function buildMiniMap(seat) {
    const zoneSeats = seatsByZone[seat.section] || [];
    if (zoneSeats.length === 0) return null;
    const xs = zoneSeats.map(s => s.pos_x);
    const ys = zoneSeats.map(s => s.pos_y);
    const pad = 15;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const width = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const height = Math.max(...ys) - Math.min(...ys) + pad * 2;
    return { zoneSeats, viewBox: `${minX} ${minY} ${width} ${height}` };
  }

  function showMessage(text, autoClearMs = 4000) {
    if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    setMessage(text);
    if (text) {
      messageTimeoutRef.current = setTimeout(() => setMessage(null), autoClearMs);
    }
  }

  useEffect(() => {
    return () => {
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!viewingSeatId) return;
    function handleEscape(e) {
      if (e.key === 'Escape') setViewingSeatId(null);
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [viewingSeatId]);

  // Keep the message anchored to the true center of the visible screen area,
  // not the full page — browser pinch-zoom can otherwise leave position:fixed
  // elements off-screen or off-center once the user scrolls/zooms.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function updateToastPosition() {
      setToastPos({
        top: vv.offsetTop + vv.height / 2,
        left: vv.offsetLeft + vv.width / 2,
      });
    }
    updateToastPosition();
    vv.addEventListener('resize', updateToastPosition);
    vv.addEventListener('scroll', updateToastPosition);
    return () => {
      vv.removeEventListener('resize', updateToastPosition);
      vv.removeEventListener('scroll', updateToastPosition);
    };
  }, []);
  const [selectedZone, setSelectedZone] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [releasingId, setReleasingId] = useState(null);
  const [confirmingReleaseId, setConfirmingReleaseId] = useState(null);

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
      supabase.from('seats').select('*').eq('show_id', showId).order('row_number', { ascending: true })
    );
    setSeats(seatData || []);

    const resData = await fetchAllRows(
      supabase
        .from('reservations')
        .select('seat_id, status, expires_at, user_id, checked_in, profiles(email)')
        .eq('show_id', showId)
        .in('status', ['locked', 'confirmed'])
    );

    const map = {};
    (resData || []).forEach(r => { map[r.seat_id] = r; });
    setReservations(map);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [showId]);

  async function handleRelease(seatId) {
    setReleasingId(seatId);
    setConfirmingReleaseId(null);
    const { data, error } = await supabase.rpc('release_seat', {
      p_seat_id: seatId,
      p_admin_id: adminId,
    });
    setReleasingId(null);

    if (error || !data?.success) {
      showMessage(t('couldNotRelease') + (data?.reason || 'error'));
      return;
    }

    showMessage(t('seatReleased'));
    loadData();
  }

  const confirmedCount = Object.values(reservations).filter(r => r.status === 'confirmed').length;
  const lockedCount = Object.values(reservations).filter(r => r.status === 'locked').length;
  const total = seats.length;

  const zones = useMemo(
    () => [...new Set(seats.map(s => s.section))].sort(),
    [seats]
  );

  const filteredSeats = useMemo(() => {
    return seats
      .filter(s => reservations[s.id])
      .filter(s => selectedZone === 'all' || s.section === selectedZone)
      .filter(s => {
        if (!searchTerm.trim()) return true;
        const label = `${s.section}${s.seat_number}`.toLowerCase();
        return label.includes(searchTerm.trim().toLowerCase());
      })
      .sort((a, b) => {
        if (a.section !== b.section) return a.section.localeCompare(b.section);
        return a.seat_number - b.seat_number;
      });
  }, [seats, reservations, selectedZone, searchTerm]);

  return (
    <div>
      <h2 className="section-heading">{t('seatOccupancy')}</h2>

      {loading ? (
        <p className="empty-state">{t('loadingOccupancy')}</p>
      ) : (
        <>
      <p className="admin-summary">
        {confirmedCount} {t('confirmedCount')} &middot; {lockedCount} {t('heldCount')} &middot; {total - confirmedCount - lockedCount} {t('availableCount')} &middot; {total} {t('totalCount')}
      </p>

      <div className="admin-filters">
        <div className="field">
          <label htmlFor="admin-zone" className="field-label">{t('zoneLabel')}</label>
          <select
            id="admin-zone"
            className="admin-select"
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value)}
          >
            <option value="all">{t('allZones')}</option>
            {zones.map(z => (
              <option key={z} value={z}>{t('zone')} {z}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="admin-search" className="field-label">{t('searchSeatLabel')}</label>
          <input
            id="admin-search"
            type="text"
            className="admin-search"
            placeholder={t('searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {message && (
        <p
          className="message-toast message-info"
          role="status"
          aria-live="polite"
          style={{ top: toastPos.top, left: toastPos.left }}
        >
          {message}
        </p>
      )}

      {filteredSeats.length === 0 ? (
        <p className="empty-state">
          {Object.keys(reservations).length === 0
            ? t('noSeatsHeldYet')
            : t('noSeatsMatchFilter')}
        </p>
      ) : (
        <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('seat')}</th>
              <th>{t('status')}</th>
              <th>{t('heldBy')}</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredSeats.map(s => {
              const r = reservations[s.id];
              return (
                <tr key={s.id}>
                  <td>{s.section}{s.seat_number}</td>
                  <td>
                    <span className={`status-badge status-${r.status}`}>{r.status}</span>
                    {r.checked_in && <span className="status-badge status-checked-in" style={{ marginLeft: 6 }}>{t('checkedIn')}</span>}
                  </td>
                  <td title={r.profiles?.email || r.user_id}>{r.profiles?.email || r.user_id}</td>
                  <td className={confirmingReleaseId === s.id ? 'admin-table-cell-wide' : ''}>
                    {confirmingReleaseId === s.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t('confirmReleaseShort')}</span>
                        <button className="btn" onClick={() => setConfirmingReleaseId(null)} disabled={releasingId === s.id}>
                          {t('cancel')}
                        </button>
                        <button
                          className="btn"
                          style={{ background: 'var(--taken)', color: '#fff', borderColor: 'var(--taken)' }}
                          onClick={() => handleRelease(s.id)}
                          disabled={releasingId === s.id}
                        >
                          {releasingId === s.id ? t('releasing') : t('yesRelease')}
                        </button>
                      </div>
                    ) : (
                      <button className="btn" onClick={() => setConfirmingReleaseId(s.id)}>
                        {t('release')}
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn admin-eye-btn"
                      onClick={() => setViewingSeatId(s.id)}
                      aria-label={t('viewSeatLocation')}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
      </>
      )}

      {viewingSeatId && (() => {
        const seat = seats.find(s => s.id === viewingSeatId);
        if (!seat) return null;
        const miniMap = buildMiniMap(seat);
        return (
          <div className="ticket-overlay" onClick={() => setViewingSeatId(null)}>
            <div
              className="ticket-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={`${t('zone')} ${seat.section}`}
            >
              <button
                className="ticket-modal-close"
                onClick={() => setViewingSeatId(null)}
                aria-label="Close"
              >
                ✕
              </button>
              <div className="ticket-modal-content">
                <p className="section-heading" style={{ marginBottom: 4 }}>
                  {t('zone')} {seat.section}
                </p>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 12 }}>
                  {t('seat')} {seat.section}{seat.seat_number} &middot; {t('row')} {seat.row_number}
                </p>
                {miniMap && (
                  <div className="find-seat-map">
                    <svg viewBox={miniMap.viewBox} className="find-seat-svg" aria-hidden="true">
                      {miniMap.zoneSeats.map(zs => (
                        <circle
                          key={zs.id}
                          cx={zs.pos_x}
                          cy={zs.pos_y}
                          r={zs.id === seat.id ? 10 : 4}
                          fill={zs.id === seat.id ? 'var(--accent)' : 'var(--border)'}
                          className={zs.id === seat.id ? 'find-seat-highlight' : ''}
                        />
                      ))}
                    </svg>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}