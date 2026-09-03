"use client";

import Link from "next/link";
import {
  useMemo,
  useRef,
  useSyncExternalStore,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph, type GlyphName } from "@/components/category-glyph";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { useAgents } from "@/hooks/use-agents";
import type { Agent, AgentCategory } from "@/types/agent";

import styles from "./page.module.css";

type CatalogFilter = {
  value: AgentCategory | null;
  label: string;
  description: string;
  glyph: GlyphName;
};

const catalogFilters: readonly CatalogFilter[] = [
  {
    value: null,
    label: "All agents",
    description: "Explore every role in the shared catalog.",
    glyph: "categories",
  },
  ...AGENT_CATEGORIES.map((category) => ({
    value: category.slug,
    label: category.label,
    description: category.description,
    glyph: category.slug,
  })),
];

const categoryChangeEvent = "dolphin:discover-category-change";

function isCatalogCategory(value: string | null): value is AgentCategory {
  return AGENT_CATEGORIES.some((category) => category.slug === value);
}

function getSelectedCategorySnapshot(): AgentCategory | null {
  if (typeof window === "undefined") return null;

  const value = new URLSearchParams(window.location.search).get("category");
  return isCatalogCategory(value) ? value : null;
}

function subscribeToCategoryChanges(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(categoryChangeEvent, onStoreChange);

  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(categoryChangeEvent, onStoreChange);
  };
}

function getCategoryLabel(category: AgentCategory) {
  return (
    AGENT_CATEGORIES.find((option) => option.slug === category)?.label ??
    "Monitoring"
  );
}

function getRecordSource(agent: Agent) {
  return agent.sourceLabels[0]?.label ?? "Source not listed";
}

function DiscoverAgentCard({ agent }: { agent: Agent }) {
  const categoryLabel = getCategoryLabel(agent.category);
  const recordLabel =
    agent.recordStatus === "indexed" ? "Indexed record" : "Editorial record";

  return (
    <Link className={styles.agentCard} href={`/agent/${agent.tokenId}`}>
      <article className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <AgentIcon category={agent.category} size={58} uri={agent.iconUrl} />
          <span className={styles.recordBadge}>
            <span aria-hidden="true" className={styles.statusDot} />
            {recordLabel}
          </span>
        </div>

        <div className="mt-6">
          <p className="text-xs font-semibold text-accent-ink">{categoryLabel}</p>
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
  const {
    data: agents,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useAgents();
  const selectedCategory = useSyncExternalStore(
    subscribeToCategoryChanges,
    getSelectedCategorySnapshot,
    () => null,
  );
  const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const hasCatalog = agents !== undefined;
  const catalog = useMemo(() => agents ?? [], [agents]);
  const visibleAgents = useMemo(
    () =>
      selectedCategory
        ? catalog.filter((agent) => agent.category === selectedCategory)
        : catalog,
    [catalog, selectedCategory],
  );
  const displayedAgents = selectedCategory
    ? visibleAgents
    : visibleAgents.slice(0, 8);
  const selectedOption = catalogFilters.find(
    (option) => option.value === selectedCategory,
  );
  const selectedLabel = selectedOption?.label ?? "All agents";
  const selectedDescription =
    selectedOption?.description ?? "Explore every role in the shared catalog.";
  const showInitialLoading = isLoading && !hasCatalog;
  const showUnavailable = isError && !hasCatalog;

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

  const resultStatus = showInitialLoading
    ? "Syncing with the catalog"
    : showUnavailable
      ? "Catalog unavailable"
      : `${visibleAgents.length} ${visibleAgents.length === 1 ? "record" : "records"}`;

  return (
    <div className={styles.page}>
      {/*
       * Full-bleed hero: the video IS the background, not a picture inside a
       * card. `site-frame` moved off the section and onto the copy — the
       * section now spans the viewport so the video can, while the text stays
       * on the same 1280px measure as every other section on the page.
       */}
      <section aria-labelledby="discover-heading" className={styles.heroSection}>
        <video
          autoPlay
          className={styles.heroBgVideo}
          loop
          muted
          playsInline
          src="https://res.cloudinary.com/ejr7iufx/video/upload/v1788251928/0901.mp4"
        />
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
        aria-labelledby="categories-heading"
        id="browse-by-role"
        className="site-frame py-14 sm:py-20"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="section-title max-w-[17ch]" id="categories-heading">
            Choose the job, not a generic score.
          </h2>
          <p className="max-w-md text-sm leading-6 text-muted">
            Each role is compared using evidence that fits the work.
          </p>
        </div>

        <div className={`${styles.filterScroller} no-scrollbar`}>
          <div
            aria-label="Filter agents by role"
            className={styles.cirTabs}
            role="tablist"
          >
            {catalogFilters.map((option, index) => {
              const isSelected = selectedCategory === option.value;
              const id = `filter-${option.value || "all"}`;

              return (
                <Fragment key={option.label}>
                  <input
                    className={styles.cirTabsR}
                    type="radio"
                    name="catalog-filter"
                    id={id}
                    checked={isSelected}
                    onChange={() => updateSelectedCategory(option.value)}
                  />
                  <label
                    className={styles.cirTabsT}
                    htmlFor={id}
                    role="tab"
                  >
                    {option.label}
                  </label>
                </Fragment>
              );
            })}
          </div>
        </div>

        <div className={`${styles.catalogLayout} mt-12 sm:mt-16`}>
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
            {isError && hasCatalog ? (
              <div className={styles.refreshAlert} role="alert">
                <span>
                  The latest refresh failed. Showing the last available catalog records.
                </span>
                <button
                  disabled={isFetching}
                  onClick={() => void refetch()}
                  type="button"
                >
                  {isFetching ? "Retrying" : "Retry"}
                </button>
              </div>
            ) : null}

            {showInitialLoading ? (
              <CatalogSkeleton />
            ) : showUnavailable ? (
              <CatalogNotice
                actionDisabled={isFetching}
                actionLabel={isFetching ? "Retrying catalog" : "Retry catalog"}
                body="Dolphin could not reach the shared agent catalog. No fallback records or performance numbers are being shown."
                onAction={() => void refetch()}
                state="unavailable"
                title="Catalog unavailable"
              />
            ) : visibleAgents.length === 0 ? (
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
                {!selectedCategory && visibleAgents.length > displayedAgents.length ? (
                  <div className={styles.viewAllRow}>
                    <Link href="/search">
                      View all {visibleAgents.length} records
                      <span aria-hidden="true">
                        <CategoryGlyph
                          color="currentColor"
                          name="arrow-right"
                          size={16}
                          strokeWidth={2}
                        />
                      </span>
                    </Link>
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
