import { BRANDS } from "../lib/brands";

export default function HomePage() {
  return (
    <div>
      <h1>Brands</h1>
      <p className="muted">Pick a brand to research, get ideas, and write copy for.</p>
      <div className="brand-grid">
        {BRANDS.map((brand) => (
          <a key={brand.id} href={`/brand/${brand.id}`} className="brand-card">
            <h2>{brand.name}</h2>
            <p className="muted">{brand.niche}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
