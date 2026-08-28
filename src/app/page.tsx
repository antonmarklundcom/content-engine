import { listBrands } from "@/lib/bridge";

// The brand list comes from the `brands` table now (PLAN.md §1.5), so this
// page reads the database on every request — it can't be prerendered at build
// time on a machine with no DATABASE_URL, and a brand edited in the table
// should show up without a redeploy. Same reasoning as /youtube's layout.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const brands = await listBrands();

  return (
    <div>
      <h1>Brands</h1>
      <p className="muted">Pick a brand to research, get ideas, and write copy for.</p>
      <div className="brand-grid">
        {brands.map((brand) => (
          <a key={brand.id} href={`/brand/${brand.id}`} className="brand-card">
            <h2>{brand.name}</h2>
            <p className="muted">{brand.niche}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
