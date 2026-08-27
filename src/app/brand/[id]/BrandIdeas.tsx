"use client";

import { useEffect, useState, useCallback } from "react";

type Idea = {
  id: number;
  title: string;
  angle: string;
  format: string;
  platform: string;
  draftCopy: string;
  visualNotes: string | null;
  citations: { claim: string; sources: string[] }[] | null;
  status: "proposed" | "approved" | "rejected";
  createdAt: string;
};

export default function BrandIdeas({ brandId }: { brandId: string }) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/ideas?brandId=${brandId}`);
    setIdeas(await res.json());
    setLoading(false);
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setGenerating(false);
    }
  }

  async function setStatus(id: number, status: Idea["status"]) {
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    await fetch(`/api/ideas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function saveCopy(id: number, draftCopy: string) {
    await fetch(`/api/ideas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftCopy }),
    });
  }

  return (
    <div>
      <div style={{ margin: "20px 0" }}>
        <button onClick={generate} disabled={generating}>
          {generating ? "Researching + writing…" : "Generate ideas"}
        </button>
        {generating && (
          <p className="muted" style={{ marginTop: 8 }}>
            Researching current trends and writing full captions — this can take a minute or two.
          </p>
        )}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : ideas.length === 0 ? (
        <p className="muted">No ideas yet — generate some.</p>
      ) : (
        ideas.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} onStatus={setStatus} onSaveCopy={saveCopy} />
        ))
      )}
    </div>
  );
}

function IdeaCard({
  idea,
  onStatus,
  onSaveCopy,
}: {
  idea: Idea;
  onStatus: (id: number, status: Idea["status"]) => void;
  onSaveCopy: (id: number, draftCopy: string) => void;
}) {
  const [copy, setCopy] = useState(idea.draftCopy);
  const [dirty, setDirty] = useState(false);

  return (
    <div className="idea-card">
      <div className="idea-head">
        <div>
          <span className={`tag ${idea.status}`}>{idea.status}</span>
          <span className="tag">{idea.format}</span>
          <span className="tag">{idea.platform}</span>
          <h2 style={{ marginTop: 8 }}>{idea.title}</h2>
          <p className="muted">{idea.angle}</p>
        </div>
      </div>

      <textarea
        rows={6}
        value={copy}
        onChange={(e) => {
          setCopy(e.target.value);
          setDirty(true);
        }}
      />

      {idea.visualNotes && (
        <p className="muted" style={{ marginTop: 8 }}>
          <strong>Visual:</strong> {idea.visualNotes}
        </p>
      )}

      {idea.citations && idea.citations.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="muted">Sources ({idea.citations.length})</summary>
          <ul className="muted">
            {idea.citations.map((c, i) => (
              <li key={i}>
                {c.claim} — {c.sources.join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="idea-actions">
        {dirty && (
          <button
            className="secondary"
            onClick={() => {
              onSaveCopy(idea.id, copy);
              setDirty(false);
            }}
          >
            Save copy
          </button>
        )}
        <button className="ok" onClick={() => onStatus(idea.id, "approved")} disabled={idea.status === "approved"}>
          Approve
        </button>
        <button className="danger" onClick={() => onStatus(idea.id, "rejected")} disabled={idea.status === "rejected"}>
          Reject
        </button>
      </div>
    </div>
  );
}
