import { notFound } from "next/navigation";
import { getBrand } from "@/lib/bridge";
import BrandIdeas from "./BrandIdeas";

// The brand list comes from the `brands` table now (PLAN.md §1.5), so this
// page reads the database on every request — it can't be prerendered at build
// time on a machine with no DATABASE_URL, and a brand edited in the table
// should show up without a redeploy. Same reasoning as /youtube's layout.
export const dynamic = "force-dynamic";

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrand(id);
  if (!brand) notFound();

  return (
    <div>
      <a href="/" className="muted">&larr; All brands</a>
      <h1 style={{ marginTop: 8 }}>{brand.name}</h1>
      <p className="muted">{brand.niche} · {brand.market} · {brand.platforms.join(", ")}</p>
      <BrandIdeas brandId={brand.id} />
    </div>
  );
}
