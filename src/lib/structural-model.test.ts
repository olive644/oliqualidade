import { describe, expect, it } from "vitest";

import { scheduleToLong } from "@/lib/schedule-normalizer";
import { classifyRows } from "@/lib/structural-model";

describe("estrutura e cronograma canônico", () => {
  const rows = [
    { Item: "Injetora N04", "jun/2025": 60, "set/2025": null, "dez/2025": 24 },
    { Item: "Injetora N05", "jun/2025": 29, "set/2025": 4, "dez/2025": null },
  ];

  it("reconhece cronograma sem depender do nome da aba", () => {
    expect(classifyRows(rows)).toMatchObject({ type: "schedule" });
  });

  it("converte tabela larga sem eliminar vazios planejados", () => {
    const long = scheduleToLong(rows);
    expect(long).toHaveLength(6);
    expect(long[0]).toMatchObject({
      item: "Injetora N04",
      period: "jun/2025",
      value: 60,
      sourceRow: 2,
    });
    expect(long.some((item) => item.value === null)).toBe(true);
  });
});
