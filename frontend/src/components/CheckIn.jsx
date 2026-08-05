// src/components/CheckIn.jsx
import { useState, useRef, useEffect, useCallback } from 'react';
import QrScanner from 'qr-scanner';
import { supabase } from '../lib/supabaseClient';

const SCAN_COOLDOWN_MS = 2000; // avoid re-processing the same code repeatedly while still in frame

export default function CheckIn({ showId, adminId }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState([]);
  const [mode, setMode] = useState('camera'); // 'camera' | 'manual'
  const [scanFeedback, setScanFeedback] = useState(null); // 'success' | 'error' | null
  const [cameraError, setCameraError] = useState(null);
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const lastScanRef = useRef({ code: null, time: 0 });
  const feedbackTimeoutRef = useRef(null);
  const resultTimeoutRef = useRef(null);

  const loadRecent = useCallback(async () => {
    const { data, error } = await supabase
      .from('reservations')
      .select('checked_in_at, seats(section, seat_number)')
      .eq('show_id', showId)
      .eq('checked_in', true)
      .order('checked_in_at', { ascending: false })
      .limit(10);

    if (!error && data) {
      setRecent(
        data.map(r => ({
          message: `Checked in — Seat ${r.seats.section}${r.seats.seat_number}`,
          time: new Date(r.checked_in_at).toLocaleTimeString(),
        }))
      );
    }
  }, [showId, setRecent]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  function showResult(result) {
    setResult(result);
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    resultTimeoutRef.current = setTimeout(() => setResult(null), 3500);
  }

  function flashFeedback(type) {
    setScanFeedback(type);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setScanFeedback(null), 1200);
  }

  const processTicket = useCallback(async (ticket) => {
    const trimmed = ticket.trim();
    if (!trimmed) return;

    const { data, error } = await supabase.rpc('check_in_ticket', {
      p_ticket_code: trimmed,
      p_admin_id: adminId,
      p_show_id: showId,
    });

    if (error) {
      showResult({ type: 'error', message: 'Scan failed — try again.' });
      flashFeedback('error');
    } else if (!data?.success) {
      const messages = {
        ticket_not_found: 'Ticket not found — check the code.',
        wrong_show: 'This ticket is for a different show.',
        already_checked_in: `Already checked in — Seat ${data.section}${data.seat_number}${
          data.checked_in_at ? ' at ' + new Date(data.checked_in_at).toLocaleTimeString() : ''
        }`,
        not_authorized: 'Not authorized to check in tickets.',
      };
      showResult({ type: 'error', message: messages[data?.reason] || 'Check-in failed.' });
      flashFeedback('error');
    } else {
      const message = `Checked in — Seat ${data.section}${data.seat_number}`;
      showResult({ type: 'success', message });
      loadRecent();
      flashFeedback('success');
    }
  }, [adminId, showId, loadRecent]);

  // Manual / USB-scanner input mode
  useEffect(() => {
    if (mode === 'manual') inputRef.current?.focus();
  }, [mode]);

  async function handleManualSubmit(e) {
    e.preventDefault();
    await processTicket(code);
    setCode('');
    inputRef.current?.focus();
  }

  // Camera scanning mode — qr-scanner gives us a bare video element with no injected UI,
  // and keeps scanning continuously with no pause/restart needed between codes.
  useEffect(() => {
    if (mode !== 'camera' || !videoRef.current) return;

    setCameraError(null);

    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        const decodedText = result.data;
        const now = Date.now();
        if (
          decodedText === lastScanRef.current.code &&
          now - lastScanRef.current.time < SCAN_COOLDOWN_MS
        ) {
          return;
        }
        lastScanRef.current = { code: decodedText, time: now };
        processTicket(decodedText);
      },
      {
        preferredCamera: 'environment',
        highlightScanRegion: false,
        highlightCodeOutline: true,
        maxScansPerSecond: 15,
        calculateScanRegion: (video) => {
          // Use most of the frame (90%) instead of the library's smaller default center-crop
          const widthRatio = 0.9;
          const heightRatio = 0.9;
          const width = video.videoWidth * widthRatio;
          const height = video.videoHeight * heightRatio;
          return {
            x: (video.videoWidth - width) / 2,
            y: (video.videoHeight - height) / 2,
            width,
            height,
            downScaledWidth: 600,
            downScaledHeight: 600,
          };
        },
      }
    );
    scannerRef.current = scanner;

    scanner.start().catch(() => {
      setCameraError('Could not access camera — check permissions, or use manual entry.');
    });

    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, [mode, processTicket]);

  return (
    <div>
      <h2 className="section-heading">Check-in</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Scan a ticket QR code with the camera, a USB/Bluetooth scanner, or type the code manually.
      </p>

      <div className="checkin-mode-toggle">
        <button
          className="tab-btn"
          onClick={() => setMode('camera')}
          style={{ color: mode === 'camera' ? 'var(--text)' : 'var(--text-dim)' }}
        >
          Camera scan
        </button>
        <button
          className="tab-btn"
          onClick={() => setMode('manual')}
          style={{ color: mode === 'manual' ? 'var(--text)' : 'var(--text-dim)' }}
        >
          Manual / scanner input
        </button>
      </div>

      {mode === 'camera' && (
        <div className={`qr-scanner-wrap ${scanFeedback ? 'scan-' + scanFeedback : ''}`}>
          <video ref={videoRef} className="qr-video" autoPlay muted playsInline />
          {cameraError && <p className="message-banner message-error">{cameraError}</p>}
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="checkin-form">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="checkin-code" className="field-label">Ticket code</label>
            <input
              id="checkin-code"
              ref={inputRef}
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan or enter ticket code"
              autoComplete="off"
              className="checkin-input"
            />
          </div>
          <button type="submit" className="btn btn-primary">Check in</button>
        </form>
      )}

      {result && (
        <p
          className={`message-banner ${result.type === 'success' ? 'message-success' : 'message-error'}`}
          role="status"
          aria-live="polite"
        >
          {result.message}
        </p>
      )}

      {recent.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 8 }}>Recent check-ins</p>
          <ul className="bookings-list">
            {recent.map((r, i) => (
              <li key={i} className="booking-item ticket-checked-in">
                {r.message} <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>· {r.time}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}