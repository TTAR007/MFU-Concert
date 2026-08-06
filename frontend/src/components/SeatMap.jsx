// src/components/SeatMap.jsx
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { supabase } from '../lib/supabaseClient';

const SEAT_WIDTH = 8;
const SEAT_HEIGHT = 7;
const BACKREST_WIDTH = 6;
const BACKREST_HEIGHT = 3.5;
const HOLD_MINUTES = 10;
const ZOOM_PADDING = 25; // margin around a zone's seats when zoomed in

export default function SeatMap({ showId, userId }) {
  const [seats, setSeats] = useState([]);
  const [reservations, setReservations] = useState({});
  const [mySelections, setMySelections] = useState([]);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState('info');
  const [now, setNow] = useState(Date.now());
  const [selectedZone, setSelectedZone] = useState(null); // null = zone overview screen
  const [panelOpen, setPanelOpen] = useState(false);
  const [lockingSeatId, setLockingSeatId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const messageTimeoutRef = useRef(null);
  const panMovedRef = useRef(false);
  const suppressClickRef = useRef(false);

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

  // Whether a seat belongs to the current user, regardless of status — used to
  // highlight the user's own confirmed/checked-in seats distinctly on the map.
  function isMyReservation(seatId) {
    const r = reservations[seatId];
    return !!r && r.user_id === userId;
  }

  useEffect(() => {
    setMySelections(prev =>
      prev.filter(id => {
        const r = reservations[id];
        return r && (!r.expires_at || new Date(r.expires_at).getTime() > now);
      })
    );
  }, [now, reservations]);

  async function handleSeatClick(seat) {
    if (suppressClickRef.current) return;
    const status = seatStatus(seat.id);
    if (status !== 'available' || lockingSeatId) return;

    if (mySelections.length >= 4) {
      showMessage('You can only select up to 4 seats.', 'error');
      return;
    }

    setLockingSeatId(seat.id);
    const { data, error } = await supabase.rpc('lock_seat', {
      p_seat_id: seat.id,
      p_user_id: userId,
    });
    setLockingSeatId(null);

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
    if (mySelections.length === 0) setPanelOpen(true);
    setMySelections(prev => [...prev, seat.id]);
    setReservations(prev => ({ ...prev, [seat.id]: { status: 'locked', user_id: userId, expires_at: expiresAt } }));
    showMessage(null);
  }

  async function handleRelease(seatId) {
    setRemovingId(seatId);
    const { data, error } = await supabase.rpc('release_own_lock', {
      p_seat_id: seatId,
      p_user_id: userId,
    });
    setRemovingId(null);

    if (error || !data?.success) {
      showMessage('Could not remove that seat. Please try again.', 'error');
      return;
    }

    setMySelections(prev => {
      const next = prev.filter(id => id !== seatId);
      if (next.length === 0) setPanelOpen(false);
      return next;
    });
    setReservations(prev => {
      const next = { ...prev };
      delete next[seatId];
      return next;
    });
  }

  async function handleConfirm() {
    setConfirming(true);
    const { data, error } = await supabase.rpc('confirm_reservation', {
      p_user_id: userId,
      p_show_id: showId,
    });

    if (error || !data?.success) {
      setConfirming(false);
      showMessage(
        'Could not confirm — your hold(s) may have expired. Please reselect your seats.',
        'error'
      );
      await loadData();
      return;
    }

    showMessage(`Booked ${data.confirmed_count} seat(s)!`, 'success');
    setMySelections([]);
    setPanelOpen(false);
    await loadData();
    setConfirming(false);

    // Fire-and-forget: email sending shouldn't block or fail the booking itself.
    supabase.functions.invoke('send-confirmation-email', { body: { showId } })
      .catch(() => { /* booking already succeeded; a failed email isn't fatal */ });
  }

  // Per-zone occupancy stats for the overview screen
  const zoneStats = useMemo(() => {
    const stats = {};
    seats.forEach(seat => {
      if (!stats[seat.section]) stats[seat.section] = { total: 0, available: 0 };
      stats[seat.section].total += 1;
      if (seatStatus(seat.id) === 'available') stats[seat.section].available += 1;
    });
    return stats;
  }, [seats, seatStatus]);

  // Seats grouped by zone, with a tight bounding viewBox per zone — used both for the
  // small shape-accurate preview on each overview tile and the zoomed-in detail view.
  const seatsByZone = useMemo(() => {
    const groups = {};
    seats.forEach(seat => {
      if (!groups[seat.section]) groups[seat.section] = [];
      groups[seat.section].push(seat);
    });
    return groups;
  }, [seats]);

  function computeViewBox(zoneSeatList, padding, extraLeft = 0) {
    if (!zoneSeatList || zoneSeatList.length === 0) return '0 0 100 100';
    const xs = zoneSeatList.map(s => s.pos_x);
    const ys = zoneSeatList.map(s => s.pos_y);
    const minX = Math.min(...xs) - padding - extraLeft;
    const maxX = Math.max(...xs) + padding;
    const minY = Math.min(...ys) - padding;
    const maxY = Math.max(...ys) + padding;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  }

  const zoneSeats = selectedZone ? (seatsByZone[selectedZone] || []) : [];

  // One label per row: row number, placed just left of that row's leftmost seat,
  // using that exact seat's y-position (rows are curved, so y varies along the row).
  const rowLabels = useMemo(() => {
    if (zoneSeats.length === 0) return [];
    const rows = {};
    zoneSeats.forEach(s => {
      if (!rows[s.row_number] || s.pos_x < rows[s.row_number].pos_x) {
        rows[s.row_number] = s;
      }
    });
    return Object.entries(rows).map(([rowNumber, leftmostSeat]) => ({
      rowNumber,
      x: leftmostSeat.pos_x - 14,
      y: leftmostSeat.pos_y,
    }));
  }, [zoneSeats]);
  const zoneViewBox = useMemo(
    () => computeViewBox(zoneSeats, ZOOM_PADDING, 16),
    [zoneSeats]
  );

  // Traces a zone's real curved outline using its actual seat coordinates —
  // front edge (nearest row), then back edge (furthest row) in reverse, closing the loop.
  function zoneOutline(zoneSeatList) {
    if (!zoneSeatList || zoneSeatList.length === 0) return '';
    const rows = [...new Set(zoneSeatList.map(s => s.row_number))].sort((a, b) => a - b);
    const edgeRow1 = zoneSeatList.filter(s => s.row_number === rows[0]).sort((a, b) => a.pos_x - b.pos_x);
    const edgeRow2 = zoneSeatList
      .filter(s => s.row_number === rows[rows.length - 1])
      .sort((a, b) => a.pos_x - b.pos_x)
      .reverse();
    return [...edgeRow1, ...edgeRow2].map(s => `${s.pos_x},${s.pos_y}`).join(' ');
  }

  function zoneCentroid(zoneSeatList) {
    if (!zoneSeatList || zoneSeatList.length === 0) return { x: 0, y: 0 };
    const xs = zoneSeatList.map(s => s.pos_x);
    const ys = zoneSeatList.map(s => s.pos_y);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  }

  // Shared viewBox covering every zone, using the real coordinate system directly —
  // so the overview's curve/proportions/left-right order automatically match the real data.
  const overviewViewBox = useMemo(() => {
    if (seats.length === 0) return '0 0 100 100';
    const xs = seats.map(s => s.pos_x);
    const ys = seats.map(s => s.pos_y);
    const pad = 20;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad - 195; // extra room above for the larger stage rect
    const maxY = Math.max(...ys) + pad;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  }, [seats]);

  const ZONE_COLORS = {
    A: '#d9a8c0',
    B: '#c4c4c4',
    C: '#b8d98a',
    D: '#8ecdd0',
    E: '#e8a8a0',
    F: '#d9d580',
  };

  const stageRect = useMemo(() => {
    if (seats.length === 0) return { x: 0, y: 0, width: 100, height: 20 };
    const xs = seats.map(s => s.pos_x);
    const minY = Math.min(...seats.map(s => s.pos_y));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const MAX_STAGE_WIDTH = 600;
    const width = Math.min((maxX - minX) * 0.9, MAX_STAGE_WIDTH);
    const height = 75;
    return {
      x: minX + (maxX - minX) / 2 - width / 2,
      y: minY - 175,
      width,
      height,
    };
  }, [seats]);

  // Angle (in degrees, from vertical) of the line connecting a zone's front-row and
  // back-row extreme point on a given side ('min' = leftmost, 'max' = rightmost).
  function edgeAngle(zoneSeatList, side) {
    if (!zoneSeatList || zoneSeatList.length === 0) return 0;
    const rows = [...new Set(zoneSeatList.map(s => s.row_number))].sort((a, b) => a - b);
    const pick = (rowNum) => {
      const rowSeats = zoneSeatList.filter(s => s.row_number === rowNum);
      return side === 'min'
        ? rowSeats.reduce((a, b) => (a.pos_x < b.pos_x ? a : b))
        : rowSeats.reduce((a, b) => (a.pos_x > b.pos_x ? a : b));
    };
    const p1 = pick(rows[0]);
    const p2 = pick(rows[rows.length - 1]);
    return Math.atan2(p2.pos_x - p1.pos_x, p2.pos_y - p1.pos_y) * (180 / Math.PI);
  }

  // The seat closest to a zone's bottom-left corner (min x, max y) — used as a rotation pivot.
  function bottomLeftCorner(zoneSeatList) {
    if (!zoneSeatList || zoneSeatList.length === 0) return { x: 0, y: 0 };
    const minX = Math.min(...zoneSeatList.map(s => s.pos_x));
    const maxY = Math.max(...zoneSeatList.map(s => s.pos_y));
    let best = zoneSeatList[0];
    let bestDist = Infinity;
    for (const s of zoneSeatList) {
      const d = Math.hypot(s.pos_x - minX, s.pos_y - maxY);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    return { x: best.pos_x, y: best.pos_y };
  }

  // The seat closest to a zone's bottom-right corner (max x, max y) — used as a rotation pivot.
  function bottomRightCorner(zoneSeatList) {
    if (!zoneSeatList || zoneSeatList.length === 0) return { x: 0, y: 0 };
    const maxX = Math.max(...zoneSeatList.map(s => s.pos_x));
    const maxY = Math.max(...zoneSeatList.map(s => s.pos_y));
    let best = zoneSeatList[0];
    let bestDist = Infinity;
    for (const s of zoneSeatList) {
      const d = Math.hypot(s.pos_x - maxX, s.pos_y - maxY);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    return { x: best.pos_x, y: best.pos_y };
  }

  // Rotate zone A (pivoting on its bottom-left corner) so its right edge is parallel to B's left edge.
  const zoneARotation = useMemo(() => {
    const aSeats = seatsByZone['A'] || [];
    const bSeats = seatsByZone['B'] || [];
    if (aSeats.length === 0 || bSeats.length === 0) return { deg: 0, cx: 0, cy: 0 };
    const aRightAngle = edgeAngle(aSeats, 'max');
    const bLeftAngle = edgeAngle(bSeats, 'min');
    const pivot = bottomLeftCorner(aSeats);
    return { deg: (aRightAngle - bLeftAngle) * 3.5, cx: pivot.x, cy: pivot.y };
  }, [seatsByZone]);

  // Mirrors zone A's rotation amount exactly (same magnitude and sign, since D uses the
  // same formula pattern as A relative to its own neighbor).
  const zoneDRotation = useMemo(() => {
    const dSeats = seatsByZone['D'] || [];
    if (dSeats.length === 0) return { deg: 0, cx: 0, cy: 0 };
    const pivot = bottomLeftCorner(dSeats);
    return { deg: zoneARotation.deg, cx: pivot.x, cy: pivot.y };
  }, [seatsByZone, zoneARotation]);

  // Mirrors zone D's rotation amount exactly (opposite sign), pivoting on F's bottom-right corner.
  const zoneFRotation = useMemo(() => {
    const fSeats = seatsByZone['F'] || [];
    if (fSeats.length === 0) return { deg: 0, cx: 0, cy: 0 };
    const pivot = bottomRightCorner(fSeats);
    return { deg: -zoneDRotation.deg, cx: pivot.x, cy: pivot.y };
  }, [seatsByZone, zoneDRotation]);

  // Mirrors zone A's rotation amount exactly (same magnitude, opposite sign) for visual symmetry.
  const zoneCRotation = useMemo(() => {
    const cSeats = seatsByZone['C'] || [];
    if (cSeats.length === 0) return { deg: 0, cx: 0, cy: 0 };
    const pivot = bottomRightCorner(cSeats);
    return { deg: -zoneARotation.deg, cx: pivot.x, cy: pivot.y };
  }, [seatsByZone, zoneARotation]);

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
      <details className="booking-rules">
        <summary>How booking works</summary>
        <ul>
          <li>Tap a zone below to view and select its seats.</li>
          <li>You can hold up to <strong>4 seats</strong> at a time.</li>
          <li>Held seats are reserved for <strong>10 minutes</strong> — confirm before time runs out or they're released automatically.</li>
          <li>Tap the ticket icon (bottom right) anytime to review your held seats and confirm your booking.</li>
          <li><span className="rules-swatch" style={{ background: 'var(--available)' }} /> Available &nbsp;
              <span className="rules-swatch" style={{ background: 'var(--spotlight)' }} /> Held by others &nbsp;
              <span className="rules-swatch" style={{ background: 'var(--stage-glow)' }} /> Held by you &nbsp;
              <span className="rules-swatch" style={{ background: 'var(--taken)' }} /> Booked &nbsp;
              <span className="rules-swatch" style={{ background: 'var(--success)' }} /> Checked in</li>
        </ul>
      </details>

      <h2 className="section-heading" style={{ textAlign: 'center' }}>C4 Building</h2>

      {showExpiryWarning && (
        <p className="expiry-warning">
          Your held seat(s) expire in {secondsLeft}s — confirm soon!
        </p>
      )}

      {!selectedZone ? (
        <div className="zone-diagram-wrap">
          <svg viewBox={overviewViewBox} className="zone-diagram" role="group" aria-label="Select a zone">
            <rect
              x={stageRect.x}
              y={stageRect.y}
              width={stageRect.width}
              height={stageRect.height}
              rx="4"
              className="zone-diagram-stage"
            />
            <text
              x={stageRect.x + stageRect.width / 2}
              y={stageRect.y + stageRect.height / 2}
              className="zone-diagram-stage-label"
            >
              STAGE
            </text>

            {['A', 'B', 'C', 'D', 'E', 'F'].map(z => {
              const zSeats = seatsByZone[z] || [];
              if (zSeats.length === 0) return null;
              const stat = zoneStats[z] || { total: 0, available: 0 };
              const full = stat.available === 0;
              const centroid = zoneCentroid(zSeats);
              return (
                <g
                  key={z}
                  className={`zone-shape ${full ? 'zone-shape-full' : ''}`}
                  transform={
                    z === 'A' ? `rotate(${zoneARotation.deg} ${zoneARotation.cx} ${zoneARotation.cy})` :
                    z === 'C' ? `rotate(${zoneCRotation.deg} ${zoneCRotation.cx} ${zoneCRotation.cy})` :
                    z === 'D' ? `rotate(${zoneDRotation.deg} ${zoneDRotation.cx} ${zoneDRotation.cy})` :
                    z === 'F' ? `rotate(${zoneFRotation.deg} ${zoneFRotation.cx} ${zoneFRotation.cy})` :
                    (z === 'B' || z === 'E') ? 'translate(0, 12)' :
                    undefined
                  }
                  onClick={() => stat.total > 0 && setSelectedZone(z)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && stat.total > 0) {
                      e.preventDefault();
                      setSelectedZone(z);
                    }
                  }}
                  role="button"
                  tabIndex={stat.total > 0 ? 0 : -1}
                  aria-label={`Zone ${z}, ${full ? 'full' : stat.available + ' seats available'}`}
                >
                  <polygon points={zoneOutline(zSeats)} fill={ZONE_COLORS[z]} />
                  <text x={centroid.x} y={centroid.y}>{z}</text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <>
          <div className="zone-detail-header">
            <button className="btn btn-text" onClick={() => setSelectedZone(null)}>
              ← Back to zones
            </button>
          </div>
          <p className="zone-detail-title">Zone {selectedZone}</p>

          <TransformWrapper
            initialScale={1}
            minScale={0.8}
            maxScale={4}
            centerOnInit
            limitToBounds
            doubleClick={{ mode: 'toggle' }}
            onPanningStart={() => { panMovedRef.current = false; }}
            onPanning={() => { panMovedRef.current = true; }}
            onPanningStop={() => {
              if (panMovedRef.current) {
                suppressClickRef.current = true;
                setTimeout(() => { suppressClickRef.current = false; }, 100);
              }
            }}
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <div className="zoom-controls-bar">
                  <button type="button" className="btn zoom-btn" onClick={() => zoomIn()} aria-label="Zoom in">+</button>
                  <button type="button" className="btn zoom-btn" onClick={() => zoomOut()} aria-label="Zoom out">−</button>
                  <button type="button" className="btn zoom-btn" onClick={() => resetTransform()} aria-label="Reset zoom">⟲</button>
                </div>
                <div className="zoom-pan-wrap">
                  <TransformComponent
                    wrapperStyle={{ width: '100%', maxWidth: 500, margin: '0 auto' }}
                    contentStyle={{ width: '100%' }}
                  >
                    <svg viewBox={zoneViewBox} style={{ width: '100%', display: 'block', cursor: lockingSeatId ? 'wait' : 'default' }}>
                      {rowLabels.map(rl => (
                        <text
                          key={rl.rowNumber}
                          x={rl.x}
                          y={rl.y}
                          className="row-label"
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          {rl.rowNumber}
                        </text>
                      ))}
                      {zoneSeats.map(seat => {
                        const status = seatStatus(seat.id);
                        const atCap = mySelections.length >= 4;
                        const clickable = status === 'available' && !atCap && !lockingSeatId;
                        const style = glow[status];
                        const mine = (status === 'confirmed' || status === 'checked_in') && isMyReservation(seat.id);
                        const label = `Seat ${seat.section}${seat.seat_number} — ${
                          status === 'checked_in' ? 'checked in' :
                          status === 'available' && atCap ? 'available, but selection limit reached' :
                          status
                        }${mine ? ' — this is your seat' : ''}`;
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
                            {mine && (
                              <circle
                                cx={seat.pos_x}
                                cy={seat.pos_y}
                                r={Math.max(SEAT_WIDTH, SEAT_HEIGHT) * 0.95}
                                fill="none"
                                stroke="#ffffff"
                                strokeWidth={1.5}
                                className="my-seat-ring"
                              />
                            )}
                            <rect
                              x={seat.pos_x - BACKREST_WIDTH / 2}
                              y={seat.pos_y - SEAT_HEIGHT / 2 - BACKREST_HEIGHT + 1.5}
                              width={BACKREST_WIDTH}
                              height={BACKREST_HEIGHT}
                              rx={1.5}
                              fill={style.fill}
                            />
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
                  </TransformComponent>
                </div>
              </>
            )}
          </TransformWrapper>
        </>
      )}

      <div className="legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--available)' }} />Available</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--spotlight)' }} />Held by others</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--stage-glow)' }} />Held by you</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--taken)' }} />Booked</span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--success)' }} />Checked in</span>
        <span className="legend-item"><span className="legend-dot legend-ring" />Your booked seat</span>
      </div>

      {message && (
        <p className={`message-toast message-${messageType}`} role="status" aria-live="polite">{message}</p>
      )}

      <button
        className={`selection-toggle ${mySelections.length === 0 ? 'selection-toggle-empty' : ''}`}
        onClick={() => mySelections.length > 0 && setPanelOpen(prev => !prev)}
        aria-expanded={panelOpen}
        aria-label={
          mySelections.length > 0
            ? `${mySelections.length} seats selected, view your tickets`
            : 'No seats selected yet'
        }
        disabled={mySelections.length === 0}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a1.5 1.5 0 0 0 0 3v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a1.5 1.5 0 0 0 0-3z" />
          <path d="M13 6v2M13 11v2M13 16v2" strokeDasharray="2 2" />
        </svg>
        <span className="selection-toggle-badge">{mySelections.length}</span>
      </button>

      {panelOpen && (
        <div className="selection-backdrop" onClick={() => setPanelOpen(false)}>
          <div
            className="selection-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Your seat selection"
          >
            <button
              className="ticket-modal-close"
              onClick={() => setPanelOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>

            <div className="selection-drawer-header">
              <span className="selection-count">
                {mySelections.length} of 4 seats selected
                {mySelections.length >= 4 && ' — limit reached'}
              </span>
            </div>

            <ul className="selection-list">
              {mySelections.map(id => {
                const seat = seats.find(s => s.id === id);
                if (!seat) return null;
                const isRemoving = removingId === id;
                return (
                  <li key={id} className="ticket-stub">
                    <div className="ticket-stub-main">
                      <span className="ticket-stub-eyebrow">SEAT</span>
                      <span className="ticket-stub-number">{seat.section}{seat.seat_number}</span>
                    </div>
                    <div className="ticket-stub-perforation" aria-hidden="true">
                      <span className="ticket-stub-notch ticket-stub-notch-top" />
                      <span className="ticket-stub-notch ticket-stub-notch-bottom" />
                    </div>
                    <button
                      className="ticket-stub-remove"
                      onClick={() => handleRelease(id)}
                      aria-label={`Remove seat ${seat.section}${seat.seat_number}`}
                      disabled={isRemoving || confirming}
                    >
                      {isRemoving ? (
                        <span className="mini-spinner" aria-hidden="true" />
                      ) : (
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            <button className="btn btn-primary" onClick={handleConfirm} style={{ width: '100%' }} disabled={confirming}>
              {confirming ? 'Confirming…' : 'Confirm booking'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}