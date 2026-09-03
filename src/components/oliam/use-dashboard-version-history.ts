import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  describeChange,
  pruneVersions,
  shouldCapture,
  snapshotDashboard,
  type DashboardVersion,
} from "@/lib/dashboard-history";
import { loadDashboardHistory, saveDashboardHistory } from "@/lib/storage";
import type { Dashboard } from "@/lib/types";

/**
 * Histórico de versões do painel: carrega o que já foi salvo, grava uma
 * versão automática 4s depois de qualquer mudança relevante (debounce — sem
 * ele, arrastar um widget ou digitar um título geraria uma versão por
 * quadro) e permite salvar/restaurar manualmente. `lastSnapshotRef` evita
 * gravar de novo o que não mudou e, principalmente, evita que a abertura de
 * um painel já vire uma versão nova idêntica à anterior.
 */
export function useDashboardVersionHistory(
  d: Dashboard,
  update: (patch: Partial<Dashboard>) => void,
) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<DashboardVersion[]>([]);
  const lastSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDashboardHistory(d.id).then((stored) => {
      if (cancelled) return;
      setVersions(stored);
      lastSnapshotRef.current = stored[0] ? JSON.stringify(stored[0].snapshot) : null;
    });
    return () => {
      cancelled = true;
    };
  }, [d.id]);

  const currentSnapshot = useMemo(() => snapshotDashboard(d), [d]);

  const storeVersion = (manual: boolean) => {
    const previous = versions[0]?.snapshot;
    const version: DashboardVersion = {
      id: `${d.id}-${Date.now().toString(36)}`,
      dashboardId: d.id,
      createdAt: Date.now(),
      summary: describeChange(previous, currentSnapshot),
      manual,
      snapshot: currentSnapshot,
    };
    const next = pruneVersions([version, ...versions]);
    setVersions(next);
    lastSnapshotRef.current = JSON.stringify(currentSnapshot);
    void saveDashboardHistory(d.id, next);
  };

  useEffect(() => {
    const serialized = JSON.stringify(currentSnapshot);
    if (lastSnapshotRef.current === serialized) return;
    // Espera a montagem estabilizar antes de guardar: sem esta pausa, arrastar
    // um widget ou digitar um título geraria uma versão por quadro, e o
    // histórico ficaria inútil justamente por excesso.
    const timer = setTimeout(() => {
      if (!shouldCapture(versions[0]?.snapshot, currentSnapshot)) return;
      storeVersion(false);
    }, 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSnapshot, versions]);

  const restoreVersion = (version: DashboardVersion) => {
    const snapshot = version.snapshot;
    update({
      name: snapshot.name,
      activeSheetIndex: Math.min(snapshot.activeSheetIndex, d.sheets.length - 1),
      sheets: d.sheets.map((sheet, index) => {
        const saved = snapshot.sheets[index];
        if (!saved) return sheet;
        // As colunas da versão guardam ordem e visibilidade, não a definição:
        // a coluna atual (com tipo, descrição e formatação de hoje) é a que
        // vale. Colunas que passaram a existir depois da versão ficam no fim,
        // visíveis, em vez de sumirem sem aviso.
        const byKey = new Map(sheet.columns.map((column) => [column.key, column]));
        const restored = saved.columns.flatMap((saved) => {
          const column = byKey.get(saved.key);
          if (!column) return [];
          byKey.delete(saved.key);
          return [{ ...column, visible: saved.visible }];
        });
        return {
          ...sheet,
          widgets: saved.widgets,
          filters: saved.filters,
          columns: [...restored, ...byKey.values()],
        };
      }),
    });
    setHistoryOpen(false);
    toast.success("Painel restaurado para a versão escolhida.");
  };

  return { versions, historyOpen, setHistoryOpen, storeVersion, restoreVersion };
}
