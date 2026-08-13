import { describe, expect, it } from "vitest";

import { createLatestTaskQueue } from "@/lib/latest-task-queue";

describe("fila de snapshots mais recentes", () => {
  it("grava o primeiro estado e pula estados intermediários concorrentes", async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    let confirmStarted!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      confirmStarted = resolve;
    });
    const queue = createLatestTaskQueue(async (value: string) => {
      calls.push(value);
      confirmStarted();
      if (value === "primeiro") await first;
      return value;
    });

    queue.push("primeiro");
    await started;
    queue.push("intermediário");
    queue.push("último");
    releaseFirst();
    await queue.flush();

    expect(calls).toEqual(["primeiro", "último"]);
  });

  it("entrega o resultado de cada gravação efetivamente executada", async () => {
    const results: string[] = [];
    const queue = createLatestTaskQueue(
      async (value: string) => value.toUpperCase(),
      (result) => results.push(result),
    );
    queue.push("salvo");
    await queue.flush();
    expect(results).toEqual(["SALVO"]);
  });
});
