import Link from "next/link";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getPost, listAssets, listPostAssets, listRelatedPosts } from "@/lib/bridge";
import { validatePostDraft, type PostDraft } from "@/lib/posts/contract";
import { formatDate } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { PostAdaptButton } from "@/components/PostAdaptButton";
import { PostAssets, type PostAssetItem } from "@/components/PostAssets";
import { PostEditor } from "@/components/PostEditor";
import { PostSchedule } from "@/components/PostSchedule";
import { PostStatusButtons } from "@/components/PostStatusButtons";
import { STUDIO_BUTTON } from "@/components/StudioStyles";
import { FORMAT_LABEL, STATUS_LABEL, statusTone } from "../model";

const SECTION = "surface-border surface-card px-5 py-4";
const HEADING = "mb-3 text-sm font-semibold text-[var(--color-ink)]";

/**
 * `/posts/[id]` — the post editor (PLAN.md §6.S15): the draft's copy and
 * slides/shots/frames, files attached from the library in order, status
 * moves, the date, "Export brief" for Higgsfield and "Adapt to family".
 */
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const post = await getPost(id);
  if (!post) notFound();

  const [attached, library, related] = await Promise.all([
    listPostAssets(id),
    listAssets({ brandId: post.brandId }),
    listRelatedPosts(id),
  ]);
  const draft = validatePostDraft(post.body).ok ? (post.body as PostDraft) : null;
  const toItem = (a: (typeof library.assets)[number]): PostAssetItem => ({
    id: a.id,
    kind: a.kind,
    name: a.localPath?.split("/").pop() ?? `asset ${a.id}`,
    thumbUrl: a.thumbPath
      ? `/api/media/asset/${a.id}/thumb`
      : a.kind === "image" && a.localPath
        ? `/api/media/asset/${a.id}`
        : null,
  });
  const attachedIds = new Set(attached.map((a) => a.assetId));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link
        href="/posts"
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        &larr; {t("posts.back")}
      </Link>
      <div className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-[var(--color-ink-muted)]">
            <span className={`font-medium ${statusTone(post.status)}`}>
              {t(STATUS_LABEL[post.status])}
            </span>
            {" · "}
            {t(FORMAT_LABEL[post.format])}
            {" · "}
            {post.handle ? `@${post.handle}` : post.brandId}
            {post.platform ? ` (${post.platform})` : ""}
            {draft ? ` · ${draft.language}` : ""}
            {post.publishedAt
              ? ` · ${t("posts.publishedAt", { date: formatDate(post.publishedAt, locale) })}`
              : ""}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
            {post.title || t("posts.untitled")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draft && (
            <>
              <a
                href={`/api/posts/${id}/export?format=brief`}
                className={STUDIO_BUTTON}
                target="_blank"
                rel="noreferrer"
              >
                {t("posts.exportBrief")}
              </a>
              <a
                href={`/api/posts/${id}/export?format=brief&as=json`}
                className={STUDIO_BUTTON}
                target="_blank"
                rel="noreferrer"
              >
                {t("posts.exportBriefJson")}
              </a>
              <Link href={`/posts/${id}/pack`} className={STUDIO_BUTTON}>
                {t("posts.openPack")}
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <PostEditor
            postId={id}
            title={post.title}
            notes={post.notes ?? ""}
            draft={draft}
            rawBody={draft ? null : JSON.stringify(post.body, null, 2)}
          />
          <section className={SECTION}>
            <h2 className={HEADING}>{t("posts.section.assets")}</h2>
            <PostAssets
              postId={id}
              attached={attached.map((a) => ({ ...toItem(a.asset), role: a.role }))}
              library={library.assets
                .filter(
                  (a) =>
                    !attachedIds.has(a.id) && a.status !== "rejected" && a.status !== "archived",
                )
                .map(toItem)}
            />
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <section className={SECTION}>
            <h2 className={HEADING}>{t("posts.section.status")}</h2>
            <PostStatusButtons
              postId={id}
              status={post.status}
              hasBody={post.body != null}
              scheduledFor={post.scheduledFor?.toISOString() ?? null}
            />
          </section>
          <section className={SECTION}>
            <h2 className={HEADING}>{t("posts.section.schedule")}</h2>
            <PostSchedule
              postId={id}
              status={post.status}
              scheduledFor={post.scheduledFor?.toISOString() ?? null}
            />
          </section>
          <section className={SECTION}>
            <h2 className={HEADING}>{t("posts.section.related")}</h2>
            {post.familyId ? (
              <>
                {draft && <PostAdaptButton postId={id} canAdapt={isOwner(user)} />}
                {related.length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
                    {t("posts.relatedNone")}
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2 text-sm">
                    {related.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`/posts/${r.id}`}
                          className="text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                        >
                          {r.handle ? `@${r.handle}` : r.brandId}
                        </Link>{" "}
                        <span className={`text-xs ${statusTone(r.status)}`}>
                          {t(STATUS_LABEL[r.status])}
                        </span>
                        {r.id === post.parentPostId && (
                          <span className="text-xs text-[var(--color-ink-muted)]"> · ↑</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--color-ink-muted)]">{t("posts.noFamily")}</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
