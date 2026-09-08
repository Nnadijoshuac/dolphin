"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import {
  CatalogUnavailable,
  useBackendStatus,
  useReportBackendStatus,
} from "@/components/backend-status";
import { HeroVideo } from "@/components/hero-video";
import { categoryDescription, categoryLabel } from "@/constants/agents";
import { useAgentList, useCategoryFacets } from "@/hooks/use-agents";
import { track } from "@/lib/analytics";
import type { Agent, AgentCategory } from "@/types/agent";

import styles from "./page.module.css";

type CatalogFilter = {
  value: AgentCategory | null;
  label: string;
  description: string;
  /** Null for "All agents", whose count is the catalog total rather than a facet. */
  count: number | null;
};

const ALL_AGENTS_FILTER: CatalogFilter = {
  value: null,
  label: "All agents",
  description:
    "Choose the job, not a generic score. Each role is compared using evidence that fits the work.",
  count: null,
};

const categoryChangeEvent = "dolphin:discover-category-change";

/**
 * A URL `?category=` value, or null.
 *
 * DELIBERATELY NOT VALIDATED against a known list. Category slugs are an open
 * set (see the note in @/constants/agents) and the browse chips are read from
 * the catalog, so this cannot know the valid set at the moment it runs - the
 * facets may not have loaded yet. Anything slug-shaped is passed through to the
 * backend, which either has agents in it or does not; the empty state already
 * says so. The old version tested against a hardcoded five and silently dropped
 * every other category on the floor.
 */
function readCategoryParam(value: string | null): AgentCategory | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed) ? trimmed : null;
}

function getSelectedCategorySnapshot(): AgentCategory | null {
  if (typeof window === "undefined") return null;

  return readCategoryParam(
    new URLSearchParams(window.location.search).get("category"),
  );
}

function subscribeToCategoryChanges(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(categoryChangeEvent, onStoreChange);

  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(categoryChangeEvent, onStoreChange);
  };
}

function getRecordSource(agent: Agent) {
  return agent.sourceLabels[0]?.label ?? "Source not listed";
}

function DiscoverAgentCard({ agent }: { agent: Agent }) {
  const label = categoryLabel(agent.category);
  const recordLabel =
    agent.recordStatus === "indexed" ? "Indexed record" : "Editorial record";

  return (
    <Link
      className={styles.agentCard}
      href={`/agent/${agent.tokenId}`}
      onClick={() =>
        track("agent_card_opened", {
          agentKey: agent.agentKey,
          category: agent.category,
          surface: "discover",
        })
      }
    >
      <article className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <AgentIcon category={agent.category} size={58} uri={agent.iconUrl} />
          <span className={styles.recordBadge}>
            <span aria-hidden="true" className={styles.statusDot} />
            {recordLabel}
          </span>
        </div>

        <div className="mt-6">
          <p className="text-xs font-semibold text-accent-ink">{label}</p>
          <h3 className="mt-2 text-xl font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-2xl">
            {agent.name}
          </h3>
          <p className={styles.agentTagline}>{agent.tagline}</p>
        </div>

        <dl className={styles.agentEvidence}>
          <div>
            <dt>Record source</dt>
            <dd>{getRecordSource(agent)}</dd>
          </div>
          <div>
            <dt>Identity</dt>
            <dd>ERC-8004 #{agent.tokenId}</dd>
          </div>
        </dl>

        <div className={styles.agentCardFooter}>
          <span>Open record</span>
          <span aria-hidden="true" className={styles.cardArrow}>
            <CategoryGlyph
              color="currentColor"
              name="arrow-right"
              size={17}
              strokeWidth={2}
            />
          </span>
        </div>
      </article>
    </Link>
  );
}

function CatalogSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={styles.agentGrid}
      role="status"
    >
      <span className="sr-only">Loading agent catalog</span>
      {[0, 1, 2, 3].map((item) => (
        <div aria-hidden="true" className={styles.skeletonCard} key={item}>
          <div className="flex items-center justify-between gap-4">
            <div className="skeleton h-[58px] w-[58px] rounded-[14px]" />
            <div className="skeleton h-6 w-24 rounded-full" />
          </div>
          <div className="mt-7 space-y-3">
            <div className="skeleton h-3 w-24 rounded-md" />
            <div className="skeleton h-7 w-2/3 rounded-md" />
            <div className="skeleton h-4 w-full rounded-md" />
            <div className="skeleton h-4 w-4/5 rounded-md" />
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 border-t border-line pt-5">
            <div className="skeleton h-10 rounded-md" />
            <div className="skeleton h-10 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

type CatalogNoticeProps = {
  title: string;
  body: string;
  state: "empty" | "unavailable";
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
};

function CatalogNotice({
  title,
  body,
  state,
  actionLabel,
  actionDisabled,
  onAction,
}: CatalogNoticeProps) {
  return (
    <div
      className={styles.catalogNotice}
      role={state === "unavailable" ? "alert" : "status"}
    >
      <span aria-hidden="true" className={styles.noticeIcon}>
        <CategoryGlyph color="currentColor" name="info" size={20} strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted">
          {state === "unavailable" ? "Unavailable" : "Nothing here yet"}
        </p>
        <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
          {title}
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{body}</p>
        {actionLabel && onAction ? (
          <button
            className={styles.noticeAction}
            disabled={actionDisabled}
            onClick={onAction}
            type="button"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const selectedCategory = useSyncExternalStore(
    subscribeToCategoryChanges,
    getSelectedCategorySnapshot,
    () => null,
  );

  /*
   * PAGINATED, and the category filter is an index range rather than a
   * client-side `.filter()` over the whole catalog (2026-09-07). The old shape
   * loaded every agent before it could draw one card.
   */
  const { agents, status, isLoading, loadMore } = useAgentList({
    category: selectedCategory ?? undefined,
  });

  /*
   * THE CHIPS, FROM THE CATALOG. See the note in @/constants/agents for what
   * this replaced and what it cost: a hardcoded five, against a backend that
   * classifies into thirteen, so eight categories - including `general`, the
   * fallback every unclassified agent lands in - had no chip anywhere on the
   * site.
   */
  const facets = useCategoryFacets();
  const backend = useBackendStatus();
  useReportBackendStatus(backend, "discover");

  const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const catalogFilters = useMemo<readonly CatalogFilter[]>(
    () => [
      ALL_AGENTS_FILTER,
      ...facets.categories.map((facet) => ({
        value: facet.slug,
        label: facet.label,
        description:
          categoryDescription(facet.slug) ??
          `Agents the catalog classifies as ${facet.label.toLowerCase()}.`,
        count: facet.count,
      })),
    ],
    [facets.categories],
  );

  const hasCatalog = agents.length > 0;
  /*
   * A REAL ERROR STATE. Both of these were literals - `const isError = false`
   * and `const refetch = () => undefined` - which made every error branch below
   * unreachable and left "the catalog is empty" as the only thing this page
   * could say about a backend it could not reach. See components/backend-status.
   */
  const isUnavailable = backend.kind === "unreachable" || backend.kind === "unconfigured";
  const isFetching = status === "LoadingMore";
  const displayedAgents = agents;
  const selectedOption = catalogFilters.find(
    (option) => option.value === selectedCategory,
  );
  const selectedLabel = selectedOption?.label ?? categoryLabel(selectedCategory);
  const selectedDescription =
    selectedOption?.description ??
    categoryDescription(selectedCategory) ??
    "Explore every role in the shared catalog.";
  /* Show the skeleton only while there is genuinely nothing to draw yet. */
  const showInitialLoading = isLoading && !hasCatalog && !isUnavailable;
  const showUnavailable = isUnavailable && !hasCatalog;

  /** Emitted once the catalog has actually rendered, not on mount. */
  const reportedCatalog = useRef(false);
  useEffect(() => {
    if (reportedCatalog.current || isLoading) return;
    reportedCatalog.current = true;
    track("catalog_viewed", {
      surface: "discover",
      categoryCount: facets.isLoading ? null : facets.categories.length,
    });
  }, [isLoading, facets.isLoading, facets.categories.length]);

  function updateSelectedCategory(category: AgentCategory | null) {
    if (category === selectedCategory) return;

    const url = new URL(window.location.href);
    if (category) {
      url.searchParams.set("category", category);
    } else {
      url.searchParams.delete("category");
    }

    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event(categoryChangeEvent));
  }

  function selectFilter(index: number) {
    const option = catalogFilters[index];
    if (!option) return;

    updateSelectedCategory(option.value);
    filterRefs.current[index]?.focus();

    if (option.value) {
      track("category_selected", {
        surface: "discover",
        category: option.value,
        count: option.count,
      });
    }
  }

  function handleFilterKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % catalogFilters.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + catalogFilters.length) % catalogFilters.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = catalogFilters.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    selectFilter(nextIndex);
  }

  /*
   * THE COUNT IS THE MATCHING TOTAL, NOT THE LOADED PAGE.
   *
   * This printed `agents.length`, which is how many have been fetched so far -
   * so it said "24 records" with a "Show more agents" button directly beneath
   * it. On a page that prints a source and a check-timestamp beside every
   * metric, the one number describing our own inventory was the misleading one.
   *
   * The real total comes from convex/facets.ts, which counts the live catalog on
   * a schedule. When it has not been computed yet the loaded count is shown with
   * a "+" rather than dressed up as a total.
   */
  const matchingTotal = selectedCategory
    ? (facets.categories.find((facet) => facet.slug === selectedCategory)?.count ?? null)
    : facets.totalLive || null;

  const resultStatus = showInitialLoading
    ? "Syncing with the catalog"
    : showUnavailable
      ? "Catalog unavailable"
      : matchingTotal !== null
        ? `${matchingTotal.toLocaleString()} ${matchingTotal === 1 ? "record" : "records"}`
        : `${displayedAgents.length}+ records loaded`;

  return (
    <div className={styles.page}>
      {/*
       * Full-bleed hero: the video IS the background, not a picture inside a
       * card. `site-frame` moved off the section and onto the copy — the
       * section now spans the viewport so the video can, while the text stays
       * on the same 1280px measure as every other section on the page.
       */}
      <section aria-labelledby="discover-heading" className={styles.heroSection}>
        {/*
         * Deferred, poster-backed and reduced-motion-aware. It used to be a
         * bare autoplaying <video> with no poster and no preload hint, which
         * made an MP4 on a third-party CDN the Largest Contentful Paint of the
         * entire site. See components/hero-video.tsx.
         */}
        <HeroVideo className={styles.heroBgVideo} />
        <div className={styles.heroOverlay} />

        <div className="site-frame">
          <div className={styles.heroCopy}>
            <p className="eyebrow">ERC-8004 discovery on BNB Chain</p>
            <h1 className={styles.heroTitle} id="discover-heading">
              <span>Know the agent.</span>
              <span>Hire with context.</span>
            </h1>
            <p className="body-copy mt-6 max-w-[52ch]">
              Compare each job, its evidence, and required access before you commit.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link className={styles.searchAction} href="/search">
                <span className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="text-muted">
                    <CategoryGlyph color="currentColor" name="search" size={19} />
                  </span>
                  <span className="truncate">Search agents, protocols, or skills</span>
                </span>
                <span aria-hidden="true" className={styles.searchArrow}>
                  <CategoryGlyph
                    color="currentColor"
                    name="arrow-right"
                    size={17}
                    strokeWidth={2}
                  />
                </span>
              </Link>
            </div>

            <ul
              aria-label="What Dolphin shows before hiring"
              className={styles.trustList}
            >
              {[
                "Registry identity",
                "Sources in view",
                "Access before hire",
              ].map((item) => (
                <li key={item}>
                  <span aria-hidden="true" className="text-accent-ink">
                    <CategoryGlyph
                      color="currentColor"
                      name="check"
                      size={16}
                      strokeWidth={2}
                    />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="catalog-heading"
        id="browse-by-role"
        className="site-frame py-14 sm:py-20"
      >
        <div className={styles.catalogLayout}>
          <aside className={styles.catalogAside}>
            <p className="text-sm font-semibold text-accent-ink">Catalog</p>
            <h2 className="section-title mt-3" id="catalog-heading">
              {selectedLabel}
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted">{selectedDescription}</p>
            <p aria-live="polite" className={styles.resultCount}>
              {resultStatus}
              {isFetching && hasCatalog ? " · Refreshing" : ""}
            </p>

            {/*
             * ===================================================================
             * THE FILTER RAIL, WHICH WAS NEVER RENDERED. (2026-09-08)
             * ===================================================================
             * `catalogFilters`, `filterRefs`, `selectFilter` and
             * `handleFilterKeyDown` all existed in this component, fully written,
             * including roving-tabindex keyboard handling - and NOTHING IN THE
             * JSX USED ANY OF THEM. `.filterScroller` sat unreferenced in
             * page.module.css for the same reason.
             *
             * So this section (id="browse-by-role") offered no roles to click.
             * The aside printed the name and description of the SELECTED
             * category while giving no way to select one: the only route to a
             * filtered Discover was hand-editing `?category=` in the URL bar.
             *
             * It is a listbox-style toolbar rather than tabs, because the panel
             * it controls is the same panel in every state - only its contents
             * change - and because the roving tabindex below is what makes one
             * Tab stop with arrow-key traversal, instead of thirteen Tab stops.
             */}
            <div
              aria-label="Filter the catalog by role"
              className={styles.filterScroller}
              role="toolbar"
            >
              {facets.isLoading
                ? [0, 1, 2, 3, 4].map((item) => (
                    <span
                      aria-hidden="true"
                      className="skeleton h-9 w-24 shrink-0 rounded-full"
                      key={item}
                    />
                  ))
                : catalogFilters.map((option, index) => {
                    const isSelected = option.value === selectedCategory;

                    return (
                      <button
                        aria-pressed={isSelected}
                        className={`${styles.filterChip} ${
                          isSelected ? styles.filterChipActive : ""
                        }`}
                        key={option.value ?? "all"}
                        onClick={() => selectFilter(index)}
                        onKeyDown={(event) => handleFilterKeyDown(event, index)}
                        ref={(node) => {
                          filterRefs.current[index] = node;
                        }}
                        /* Roving tabindex: one stop for the whole rail. */
                        tabIndex={
                          isSelected || (selectedCategory === null && index === 0)
                            ? 0
                            : -1
                        }
                        type="button"
                      >
                        {option.label}
                        {option.count !== null ? (
                          <span className={styles.filterChipCount}>
                            {option.count.toLocaleString()}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
            </div>

            <div className={styles.readingGuide}>
              <p className="font-semibold text-ink">Read the record first</p>
              <ul className="mt-3 space-y-2.5 text-sm leading-5 text-muted">
                <li>Confirm the agent identity and publisher.</li>
                <li>Check the source behind every available metric.</li>
                <li>Review requested access before you hire.</li>
              </ul>
            </div>
          </aside>

          <div
            aria-busy={showInitialLoading || isFetching}
            className={styles.catalogPanel}
            id="agent-catalog"
          >
            {isUnavailable && hasCatalog ? (
              <div className={styles.refreshAlert} role="alert">
                <span>
                  The connection to the catalog dropped. These are the last
                  records Dolphin received, and they may be out of date.
                </span>
              </div>
            ) : null}

            {showInitialLoading ? (
              <CatalogSkeleton />
            ) : showUnavailable ? (
              <CatalogUnavailable
                status={
                  backend as Extract<
                    typeof backend,
                    { kind: "unreachable" | "unconfigured" }
                  >
                }
              />
            ) : displayedAgents.length === 0 ? (
              <CatalogNotice
                actionLabel={selectedCategory ? "Show all agents" : undefined}
                body={
                  selectedCategory
                    ? "No catalog records are available for this role yet. Choose another role or show every agent."
                    : "The shared catalog does not contain any agent records yet."
                }
                onAction={
                  selectedCategory ? () => updateSelectedCategory(null) : undefined
                }
                state="empty"
                title={selectedCategory ? `No ${selectedLabel} agents yet` : "Catalog is empty"}
              />
            ) : (
              <>
                <div className={styles.agentGrid}>
                  {displayedAgents.map((agent) => (
                    <DiscoverAgentCard agent={agent} key={agent.id} />
                  ))}
                </div>
                {status === "CanLoadMore" ? (
                  <div className={styles.viewAllRow}>
                    <button onClick={() => loadMore()} type="button">
                      Show more agents
                      <span aria-hidden="true">
                        <CategoryGlyph
                          color="currentColor"
                          name="arrow-right"
                          size={16}
                          strokeWidth={2}
                        />
                      </span>
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
