// src/components/AdminView.jsx
import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function AdminView({ showId, adminId }) {
  const [seats, setSeats] = useState([]);
  const [reservations, setReservations] = useState({});
  const [message, setMessage] = useState(null);
  const [selectedZone, setSelectedZone] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

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
  }

  useEffect(() => { loadData(); }, [showId]);

  async function handleRelease(seatId) {
    const { data, error } = await supabase.rpc('release_seat', {
      p_seat_id: seatId,
      p_admin_id: adminId,
    });

    if (error || !data?.success) {
      setMessage('Could not release seat: ' + (data?.reason || 'error'));
      return;
    }

    setMessage('Seat released.');
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
      <h2 className="section-heading">Seat occupancy</h2>
      <p className="admin-summary">
        {confirmedCount} confirmed &middot; {lockedCount} currently held &middot; {total - confirmedCount - lockedCount} available &middot; {total} total
      </p>

      <div className="admin-filters">
        <div className="field">
          <label htmlFor="admin-zone" className="field-label">Zone</label>
          <select
            id="admin-zone"
            className="admin-select"
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value)}
          >
            <option value="all">All zones</option>
            {zones.map(z => (
              <option key={z} value={z}>Zone {z}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="admin-search" className="field-label">Search seat</label>
          <input
            id="admin-search"
            type="text"
            className="admin-search"
            placeholder="e.g. B47"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {message && <p className="message-banner message-info" role="status" aria-live="polite">{message}</p>}

      {filteredSeats.length === 0 ? (
        <p className="empty-state">
          {Object.keys(reservations).length === 0
            ? 'No seats held or booked yet.'
            : 'No seats match this filter.'}
        </p>
      ) : (
        <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Seat</th>
              <th>Status</th>
              <th>Held by</th>
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
                    {r.checked_in && <span className="status-badge status-checked-in" style={{ marginLeft: 6 }}>Checked in</span>}
                  </td>
                  <td title={r.profiles?.email || r.user_id}>{r.profiles?.email || r.user_id}</td>
                  <td>
                    <button className="btn" onClick={() => handleRelease(s.id)}>Release</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}