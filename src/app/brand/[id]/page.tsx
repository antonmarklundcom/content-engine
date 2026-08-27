import { BRANDS } from "../../../lib/brands";
import { notFound } from "next/navigation";
import BrandIdeas from "./BrandIdeas";

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = BRANDS.find((b) => b.id === id);
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
