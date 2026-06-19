'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type CellValueChangedEvent,
  type CellKeyDownEvent,
  type GridReadyEvent,
  type GridApi,
} from 'ag-grid-community';
import toast from 'react-hot-toast';

import {
  flattenSetToRows,
  applyRowsToSet,
  validateDeduction,
  isTierField,
  EDITABLE_FIELDS,
  type DeductionRow,
} from '../../utils/conditionSets';

// Community modules only. Range selection / clipboard / fill handle are
// Enterprise features and are intentionally NOT registered — paste and
// fill-down below are implemented manually so no Enterprise license is needed.
ModuleRegistry.registerModules([AllCommunityModule]);

const TIER_LABEL: Record<string, string> = { t1: 'Tier 1', t2: 'Tier 2', t3: 'Tier 3' };

interface Props {
  /** The currently selected condition set (= EngineSettingsModal `editingSet`). */
  set: any;
  /**
   * Persist a new version of the whole set. Parent does the optimistic local
   * update + writeConditionSet() + rollback, and MUST reject the promise on
   * failure so this component can revert the affected grid cells.
   */
  onCommit: (newSet: any) => Promise<void>;
}

export const DeductionTableView: React.FC<Props> = ({ set, onCommit }) => {
  const apiRef = useRef<GridApi<DeductionRow> | null>(null);
  // Latest set (structure + name) for rebuilding on commit without stale closures.
  const setRef = useRef<any>(set);
  useEffect(() => { setRef.current = set; }, [set]);
  // Cells to paint red briefly after a rejected validation. Key = `rowKey:field`.
  const errorCells = useRef<Set<string>>(new Set());

  // rowData is reset only when switching to a different set, so same-set commits
  // (which re-pass the `set` prop) don't blow away the grid's in-place edits.
  const initialRows = useMemo(() => flattenSetToRows(set), [set?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onGridReady = useCallback((e: GridReadyEvent<DeductionRow>) => {
    apiRef.current = e.api;
  }, []);

  const refreshErrorCells = () => apiRef.current?.refreshCells({ force: true });

  const flashError = (cells: { rowKey: string; field: string }[]) => {
    for (const c of cells) errorCells.current.add(`${c.rowKey}:${c.field}`);
    refreshErrorCells();
    setTimeout(() => {
      for (const c of cells) errorCells.current.delete(`${c.rowKey}:${c.field}`);
      refreshErrorCells();
    }, 1800);
  };

  const cellStyle = (p: any) =>
    errorCells.current.has(`${p.data?.rowKey}:${p.colDef.field}`)
      ? { backgroundColor: '#fee2e2', color: '#b91c1c' }
      : null;

  const readRows = (): DeductionRow[] => {
    const out: DeductionRow[] = [];
    apiRef.current?.forEachNode((n) => n.data && out.push(n.data));
    return out;
  };

  /**
   * Optimistically apply already-validated edits, persist via parent, and
   * revert the touched cells if the RTDB write fails.
   * `undo` carries the previous value of every cell changed in this batch.
   */
  const commit = async (undo: { rowKey: string; field: string; old: any }[]) => {
    const api = apiRef.current;
    if (!api) return;
    const newSet = applyRowsToSet(setRef.current, readRows());
    try {
      await onCommit(newSet); // parent toasts on failure
    } catch {
      for (const u of undo) {
        const node = api.getRowNode(u.rowKey);
        node?.setDataValue(u.field, u.old);
      }
    }
  };

  // --- single cell edit ---------------------------------------------------
  const onCellValueChanged = useCallback((e: CellValueChangedEvent<DeductionRow>) => {
    const field = e.colDef.field as string;
    if (isTierField(field)) {
      const res = validateDeduction(e.newValue);
      if (!res.ok) {
        e.node.setDataValue(field, e.oldValue ?? 0);
        flashError([{ rowKey: e.data.rowKey, field }]);
        toast.error(`${TIER_LABEL[field]}: ${res.reason}`);
        return;
      }
    }
    commit([{ rowKey: e.data.rowKey, field, old: e.oldValue }]);
  }, []);

  // --- paste (multi-cell, from Google Sheets / Excel) ---------------------
  const handlePaste = useCallback((ev: React.ClipboardEvent) => {
    const api = apiRef.current;
    if (!api) return;
    // Let the cell editor handle paste while a cell is being edited.
    if (api.getEditingCells().length > 0) return;

    const focused = api.getFocusedCell();
    if (!focused) return;

    ev.preventDefault();
    ev.stopPropagation();

    const text = ev.clipboardData.getData('text/plain');
    if (!text) return;

    const matrix = text
      .replace(/\r/g, '')
      .replace(/\n$/, '')
      .split('\n')
      .map((line) => line.split('\t'));

    const editable = EDITABLE_FIELDS as readonly string[];
    const startCol = focused.column.getColId();
    const startColPos = editable.indexOf(startCol);
    if (startColPos < 0) {
      toast.error('เริ่มวางที่คอลัมน์ที่แก้ไขได้ (Label / Tier 1-3)');
      return;
    }
    const startRow = focused.rowIndex;

    // Resolve every target cell, clipping to the grid bounds.
    type Target = { rowKey: string; field: string; raw: string; node: any };
    const targets: Target[] = [];
    for (let r = 0; r < matrix.length; r++) {
      const node = api.getDisplayedRowAtIndex(startRow + r);
      if (!node?.data) break; // clip extra rows
      for (let c = 0; c < matrix[r].length; c++) {
        const field = editable[startColPos + c];
        if (!field) break; // clip extra cols
        targets.push({ rowKey: node.data.rowKey, field, raw: matrix[r][c], node });
      }
    }
    if (targets.length === 0) return;

    // Validate the WHOLE batch first; reject all on any invalid tier cell.
    const errors: { rowKey: string; field: string }[] = [];
    const coerced = new Map<Target, any>();
    for (const t of targets) {
      if (isTierField(t.field)) {
        const res = validateDeduction(t.raw);
        if (!res.ok) errors.push({ rowKey: t.rowKey, field: t.field });
        else coerced.set(t, res.value);
      } else {
        coerced.set(t, t.raw);
      }
    }
    if (errors.length > 0) {
      flashError(errors);
      toast.error(`วางไม่สำเร็จ: มี ${errors.length} ช่องค่าไม่ถูกต้อง (ต้องเป็นตัวเลข ≥ 0) — ไม่บันทึกทั้งชุด`);
      return;
    }

    // Apply + persist; capture old values for rollback.
    const undo: { rowKey: string; field: string; old: any }[] = [];
    for (const t of targets) {
      undo.push({ rowKey: t.rowKey, field: t.field, old: t.node.data[t.field] });
      t.node.setDataValue(t.field, coerced.get(t));
    }
    commit(undo);
  }, []);

  // --- fill-down (Ctrl/Cmd + D) -------------------------------------------
  const onCellKeyDown = useCallback((e: CellKeyDownEvent<DeductionRow>) => {
    const ke = e.event as KeyboardEvent | null;
    if (!ke || !(ke.ctrlKey || ke.metaKey) || ke.key.toLowerCase() !== 'd') return;
    ke.preventDefault();

    const api = apiRef.current;
    if (!api || !e.colDef.field) return;
    const field = e.colDef.field as string;
    if (!(EDITABLE_FIELDS as readonly string[]).includes(field)) {
      toast.error('Fill-down ได้เฉพาะคอลัมน์ที่แก้ไขได้');
      return;
    }

    const selected = api.getSelectedNodes();
    if (selected.length === 0) {
      toast.error('เลือกแถวปลายทาง (ติ๊กช่องด้านซ้าย) ก่อน fill-down');
      return;
    }

    const sourceValue = (e.data as any)[field];
    if (isTierField(field)) {
      const res = validateDeduction(sourceValue);
      if (!res.ok) {
        toast.error(`ค่าตั้งต้นไม่ถูกต้อง: ${res.reason}`);
        return;
      }
    }

    const undo: { rowKey: string; field: string; old: any }[] = [];
    for (const node of selected) {
      if (!node.data) continue;
      undo.push({ rowKey: node.data.rowKey, field, old: (node.data as any)[field] });
      node.setDataValue(field, sourceValue);
    }
    if (undo.length === 0) return;
    commit(undo);
    toast.success(`Fill-down ${undo.length} แถว`);
  }, []);

  const columnDefs = useMemo<ColDef<DeductionRow>[]>(
    () => [
      {
        headerName: 'หัวข้อ (Group)',
        field: 'groupTitle',
        editable: false,
        minWidth: 180,
        flex: 1.2,
        cellClass: 'bkk-ro-cell',
        // group cells from the same group render once visually via rowSpan-like styling is overkill; keep plain.
      },
      {
        headerName: 'ตัวเลือก (Condition)',
        field: 'label',
        editable: true,
        minWidth: 200,
        flex: 1.6,
        cellStyle,
      },
      {
        headerName: 'Tier 1 (฿)',
        field: 't1',
        editable: true,
        width: 130,
        type: 'numericColumn',
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0, precision: 0 },
        cellStyle,
      },
      {
        headerName: 'Tier 2 (฿)',
        field: 't2',
        editable: true,
        width: 130,
        type: 'numericColumn',
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0, precision: 0 },
        cellStyle,
      },
      {
        headerName: 'Tier 3 (฿)',
        field: 't3',
        editable: true,
        width: 130,
        type: 'numericColumn',
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0, precision: 0 },
        cellStyle,
      },
    ],
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({ resizable: true, sortable: false, suppressKeyboardEvent: () => false }),
    [],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-1 pb-3 text-xs font-bold text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          ชุดประเมิน: <span className="text-indigo-700 font-black">{set?.name}</span>
          <span className="text-slate-400"> (read-only)</span>
        </span>
        <span className="text-slate-400">
          แก้ในตารางได้เลย • วาง (paste) จาก Google Sheets ได้ • เลือกแถวแล้ว Ctrl/Cmd+D = fill-down
        </span>
      </div>
      <div className="flex-1 min-h-[300px]" onPasteCapture={handlePaste}>
        <AgGridReact<DeductionRow>
          theme={themeQuartz}
          className="h-full w-full"
          rowData={initialRows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p) => p.data.rowKey}
          onGridReady={onGridReady}
          onCellValueChanged={onCellValueChanged}
          onCellKeyDown={onCellKeyDown}
          rowSelection={{ mode: 'multiRow', enableClickSelection: false }}
          selectionColumnDef={{ pinned: 'left', width: 44 }}
          stopEditingWhenCellsLoseFocus
          singleClickEdit={false}
          animateRows={false}
        />
      </div>
    </div>
  );
};

export default DeductionTableView;
