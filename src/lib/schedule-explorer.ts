import type { Row } from "@/lib/types";
import type { ScheduleCellState } from "@/lib/schedule-normalizer";

export type ScheduleExplorerEntry = {
  row: Row;
  sourceIndex: number;
  item: string;
  section: string;
  status: string;
  details: string[];
  periods: string[];
  states: ScheduleCellState[];
};

export type ScheduleStateFilter = "all" | ScheduleCellState;
export type ScheduleSortKey = "source" | "item" | "section" | "status";
export type ScheduleSortDirection = "asc" | "desc";

export type ScheduleExplorerOptions = {
  query: string;
  state: ScheduleStateFilter;
  section: string;
  sort: ScheduleSortKey;
  direction: ScheduleSortDirection;
};

const collator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function sortValue(entry: ScheduleExplorerEntry, key: ScheduleSortKey) {
  if (key === "source") return entry.sourceIndex;
  if (key === "status") {
    return entry.status || entry.states.find((state) => state !== "empty") || "empty";
  }
  return entry[key];
}

/** Filtra e ordena o cronograma sem alterar ou reinterpretar os dados de origem. */
export function exploreScheduleRows(
  entries: ScheduleExplorerEntry[],
  options: ScheduleExplorerOptions,
) {
  const query = normalized(options.query);
  const filtered = entries.filter((entry) => {
    if (options.state !== "all" && !entry.states.includes(options.state)) return false;
    if (options.section && entry.section !== options.section) return false;
    if (!query) return true;
    return normalized(
      [entry.item, entry.section, entry.status, ...entry.details, ...entry.periods].join(" "),
    ).includes(query);
  });

  return filtered.sort((left, right) => {
    const leftValue = sortValue(left, options.sort);
    const rightValue = sortValue(right, options.sort);
    const comparison =
      typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : collator.compare(String(leftValue), String(rightValue));
    if (comparison !== 0) return options.direction === "asc" ? comparison : -comparison;
    return left.sourceIndex - right.sourceIndex;
  });
}
