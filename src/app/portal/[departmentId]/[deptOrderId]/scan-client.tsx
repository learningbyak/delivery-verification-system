"use client";

import { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { createClient } from "@/lib/supabase/client";

const SCANNER_ELEMENT_ID = "portal-barcode-reader";
// After a successful scan, pause detection briefly so the same
// physical barcode sitting in frame doesn't fire repeatedly before
// the person has moved to the next item.
const POST_SCAN_PAUSE_MS = 1500;

type ScanResult = {
  result: "ok" | "wrong_department" | "not_found" | "locked" | "duplicate" | "error";
  message?: string;
  description?: string;
  received_qty?: number;
  ordered_qty?: number;
};

export default function ScanClient({
  departmentId,
  deptOrderId,
  invoiceNumber,
}: {
  departmentId: string;
  deptOrderId: string;
  invoiceNumber: string;
}) {
  const storageKey = `portal-event-${deptOrderId}`;
  // Lazy initializer, not an effect: reads any in-progress session for
  // this device on first render, avoiding an extra render pass.
  const [eventId, setEventId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(storageKey)
  );
  const [staffName, setStaffName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameLoading, setNameLoading] = useState(false);

  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [manualBarcode, setManualBarcode] = useState("");
  const [manualQty, setManualQty] = useState("1");
  const [showManual, setShowManual] = useState(false);

  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const processingRef = useRef(false);

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setNameLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("delivery_events")
      .insert({ dept_order_id: deptOrderId, staff_name: staffName.trim() })
      .select("event_id")
      .single();

    setNameLoading(false);

    if (error || !data) {
      setNameError("Could not start scanning session. Please try again.");
      return;
    }

    sessionStorage.setItem(storageKey, data.event_id);
    setEventId(data.event_id);
  }

  async function submitScan(barcodeValue: string, scannedQty: number, method: "camera" | "manual") {
    if (!eventId) return;

    const idempotencyKey = crypto.randomUUID();

    try {
      const res = await fetch("/api/portal/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          barcode_value: barcodeValue,
          idempotency_key: idempotencyKey,
          scanned_qty: scannedQty,
          method,
        }),
      });
      const body: ScanResult = await res.json();
      setLastResult(body);
    } catch {
      setLastResult({ result: "error", message: "Could not reach the server. Check your connection." });
    }
  }

  // Camera scanner lifecycle — only runs once a name has been entered.
  useEffect(() => {
    if (!eventId) return;

    const scanner = new Html5QrcodeScanner(
      SCANNER_ELEMENT_ID,
      {
        fps: 10,
        qrbox: { width: 250, height: 150 },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
        rememberLastUsedCamera: true,
      },
      false
    );

    scanner.render(
      (decodedText) => {
        if (processingRef.current) return;
        processingRef.current = true;

        submitScan(decodedText, 1, "camera").finally(() => {
          scanner.pause(true);
          setTimeout(() => {
            scanner.resume();
            processingRef.current = false;
          }, POST_SCAN_PAUSE_MS);
        });
      },
      () => {
        // Per-frame "no code found" callback — expected constantly
        // while aiming the camera, intentionally not surfaced as an
        // error.
      }
    );

    scannerRef.current = scanner;

    return () => {
      scanner.clear().catch(() => {
        // Best-effort cleanup — nothing actionable if this fails.
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(manualQty);
    if (!manualBarcode.trim() || !Number.isFinite(qty) || qty <= 0) return;
    await submitScan(manualBarcode.trim(), qty, "manual");
    setManualBarcode("");
    setManualQty("1");
  }

  if (!eventId) {
    return (
      <main style={{ maxWidth: 380 }}>
        <p style={{ marginBottom: "0.5rem" }}>
          <a href={`/portal/${departmentId}`}>← Invoices</a>
        </p>
        <h1 style={{ fontSize: "1.15rem" }}>Invoice {invoiceNumber}</h1>
        <div style={{ marginTop: "1.5rem" }}>
          <p>Enter your name to start scanning:</p>
          <form onSubmit={handleNameSubmit} style={{ display: "grid", gap: "0.75rem" }}>
            <input
              type="text"
              required
              autoFocus
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="Your name"
              style={{ padding: "0.8rem", fontSize: "1rem" }}
            />
            {nameError && <p style={{ color: "crimson", margin: 0 }}>{nameError}</p>}
            <button type="submit" disabled={nameLoading} style={{ padding: "0.8rem", fontSize: "1rem" }}>
              {nameLoading ? "Starting…" : "Start scanning"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 420 }}>
      <p style={{ marginBottom: "0.5rem" }}>
        <a href={`/portal/${departmentId}`}>← Invoices</a>
      </p>
      <h1 style={{ fontSize: "1.15rem" }}>Invoice {invoiceNumber}</h1>

      <div id={SCANNER_ELEMENT_ID} style={{ marginTop: "1rem" }} />

      {lastResult && (
        <div
          role="status"
          style={{
            marginTop: "1rem",
            padding: "1rem",
            borderRadius: 8,
            background:
              lastResult.result === "ok"
                ? "#e6f4ea"
                : lastResult.result === "duplicate"
                ? "#fff8e1"
                : "#fdecea",
            color:
              lastResult.result === "ok" ? "#1e7e34" : lastResult.result === "duplicate" ? "#8a6d00" : "#a12622",
          }}
        >
          {lastResult.result === "ok" && (
            <>
              <strong>{lastResult.description}</strong>
              <div>Received so far: {lastResult.received_qty}</div>
            </>
          )}
          {lastResult.result !== "ok" && <div>{lastResult.message}</div>}
        </div>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        <button onClick={() => setShowManual((s) => !s)} style={{ padding: "0.6rem 1rem" }}>
          {showManual ? "Hide manual entry" : "Barcode won't scan? Enter manually"}
        </button>

        {showManual && (
          <form onSubmit={handleManualSubmit} style={{ display: "grid", gap: "0.6rem", marginTop: "0.75rem" }}>
            <input
              type="text"
              required
              placeholder="Barcode number"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              style={{ padding: "0.7rem", fontSize: "1rem" }}
            />
            <input
              type="number"
              required
              min={1}
              value={manualQty}
              onChange={(e) => setManualQty(e.target.value)}
              style={{ padding: "0.7rem", fontSize: "1rem" }}
            />
            <button type="submit" style={{ padding: "0.7rem" }}>
              Submit
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
