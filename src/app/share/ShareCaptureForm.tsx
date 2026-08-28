"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ShareCaptureForm({
  initialUrl,
  initialNote,
}: {
  initialUrl: string;
  initialNote: string;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, note: note || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, text: body.error ?? `Request failed (${res.status})` });
        return;
      }
      setResult({ ok: true, text: "Saved to the inbox." });
      setTimeout(() => router.push("/inbox"), 900);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1>Save this clip</h1>
      <p className="muted" style={{ marginTop: 4 }}>
        Confirm the link and add a note if you want one.
      </p>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          autoFocus={!url}
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why did you save this? (optional)"
        />
        <button onClick={save} disabled={saving || !url}>
          {saving ? "Saving…" : "Save"}
        </button>
        {result && (
          <p style={{ color: result.ok ? "var(--ok)" : "var(--danger)" }}>{result.text}</p>
        )}
      </div>
    </div>
  );
}
