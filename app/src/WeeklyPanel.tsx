import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { PRIORITY } from "./domain";
import { shiftDay, weekRange, weekStart, weeklyDailyId } from "./weekly";
import { useWeeklyTasks } from "./useWeeklyTasks";
import type { Priority, Task, WeeklyTask } from "./types";

export function WeeklyPanel({ userId, day, dailyTasks, dailyBusy, dailyReady, refreshTick, onBusy, onSchedule, onNotice, onEditing }: {
  userId: string; day: string; dailyTasks: Task[]; dailyBusy: boolean; dailyReady: boolean;
  refreshTick: number; onBusy: (value: boolean) => void;
  onSchedule: (task: WeeklyTask, expectedDay: string) => Promise<void>;
  onNotice: (text: string) => void;
  onEditing: (value: boolean) => void;
}) {
  const currentWeek = weekStart(day);
  const [selected, setSelected] = useState<string | null>(null);
  const week = selected || currentWeek;
  const weekly = useWeeklyTasks(userId, week);
  const [expanded, setExpanded] = useState(true);
  const [editor, setEditor] = useState<WeeklyTask | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<WeeklyTask | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const lock = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const [showDock, setShowDock] = useState(false);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new IntersectionObserver(([entry]) => setShowDock(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const done = weekly.rows.filter((task) => task.completed).length;
  const percent = weekly.rows.length ? Math.round(done / weekly.rows.length * 100) : 0;
  const busy = weekly.busy || scheduleBusy;
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => { if (refreshTick) void weekly.refresh(); }, [refreshTick, weekly.refresh]);
  useEffect(() => {
    onEditing(editor !== undefined || Boolean(deleting));
    return () => onEditing(false);
  }, [editor, deleting, onEditing]);
  const changeWeek = (next: string | null) => {
    setSelected(next === currentWeek ? null : next); setScheduleError(""); setExpanded(true);
  };
  return <>
    {showDock && <button className="weekly-mobile-dock" aria-label="查看每周总任务" onClick={() => { setExpanded(true); panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><CalendarRange size={17} /><strong>{week === currentWeek ? "本周计划" : "每周计划"}</strong><span>{done} / {weekly.rows.length} 项完成</span><ChevronDown size={16} /></button>}
    <section ref={panelRef} className={`weekly-panel panel ${expanded ? "is-expanded" : ""}`} aria-label="每周总任务">
      <div className="weekly-heading">
        <button className="weekly-summary" aria-expanded={expanded} aria-controls="weekly-body" onClick={() => setExpanded(!expanded)}>
          <span className="weekly-icon"><CalendarRange size={20} /></span>
          <span><strong>{week === currentWeek ? "本周计划" : "每周计划"}</strong><small>{weekRange(week)}</small></span>
          <ChevronDown className={expanded ? "weekly-chevron open" : "weekly-chevron"} size={16} />
        </button>
      </div>
      <div className="weekly-progress-line">
        <span>{weekly.loading ? "正在同步周计划…" : weekly.ready ? `${done} / ${weekly.rows.length} 项完成` : "周计划暂不可用"}</span>
        <strong>{percent}%</strong>
      </div>
      <div className="progress-track" role="progressbar" aria-label="每周完成百分比" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div style={{ width: `${percent}%` }} /></div>
      <div className="weekly-body" id="weekly-body" hidden={!expanded}>
        <div className="weekly-navigation">
          <button className="icon-button" disabled={busy} aria-label="上一周" onClick={() => changeWeek(shiftDay(week, -7))}><ChevronLeft size={16} /></button>
          <button className="text-button" disabled={busy || week === currentWeek} onClick={() => changeWeek(null)}>回到本周</button>
          <button className="icon-button" disabled={busy} aria-label="下一周" onClick={() => changeWeek(shiftDay(week, 7))}><ChevronRight size={16} /></button>
        </div>
        {(weekly.error || scheduleError) && <div role="alert" className="error-box weekly-error"><span>{scheduleError || weekly.error}</span><button className="text-button" disabled={busy} onClick={() => { setScheduleError(""); void weekly.refresh(); }}>重试</button></div>}
        {!weekly.loading && weekly.ready && !weekly.rows.length && <div className="weekly-empty"><CalendarRange size={26} /><h3>{week === currentWeek ? "把周一的安排放在这里" : "这一周还没有计划"}</h3><p>记录本周要交付的事，再分配到每天。</p></div>}
        <ul className="weekly-list">
          {weekly.rows.map((task) => {
            const scheduled = dailyTasks.some((item) => item.id === weeklyDailyId(task.id, day));
            return <li key={task.id} className={`weekly-task ${task.completed ? "completed" : ""}`} data-testid="weekly-task">
              <button className="complete-button" aria-label={`${task.completed ? "恢复周任务" : "完成周任务"}：${task.name}`} aria-pressed={task.completed} disabled={busy || !weekly.ready} onClick={() => void weekly.toggle(task).then(() => onNotice(task.completed ? "周任务已恢复" : "周任务已完成")).catch(() => {})}>{task.completed && <Check size={15} />}</button>
              <div className="weekly-task-content">
                <div className="weekly-task-title"><h3>{task.name}</h3><span className={`priority ${task.priority}`}>{PRIORITY[task.priority]}</span></div>
                <div className="weekly-task-actions">
                  {!task.completed && <button className="text-button weekly-schedule" disabled={busy || dailyBusy || !dailyReady || scheduled} aria-label={`安排到今天：${task.name}`} onClick={async () => {
                    if (lock.current) return;
                    lock.current = true; setScheduleBusy(true); setScheduleError("");
                    try { await onSchedule(task, day); onNotice("已安排到今天，周目标可继续推进"); }
                    catch (e) { setScheduleError(e instanceof Error ? e.message : "安排失败，请重试"); }
                    finally { lock.current = false; setScheduleBusy(false); }
                  }}><ArrowDownToLine size={12} />{scheduled ? "已安排到今天" : "安排到今天"}</button>}
                  <button className="icon-button" disabled={busy} aria-label={`编辑周任务：${task.name}`} onClick={() => setEditor(task)}><Pencil size={13} /></button>
                  <button className="icon-button danger" disabled={busy} aria-label={`删除周任务：${task.name}`} onClick={() => setDeleting(task)}><Trash2 size={13} /></button>
                </div>
              </div>
            </li>;
          })}
        </ul>
        <button className="button weekly-add" disabled={busy || !weekly.ready} onClick={() => setEditor(null)}><Plus size={16} />添加周任务</button>
        <p className="weekly-hint">周目标完成后单独勾选 · 每周一开启新计划</p>
      </div>
    </section>
    {editor !== undefined && <WeeklyEditor key={editor?.id || week} task={editor} week={week} onClose={() => setEditor(undefined)} onSave={async (input) => { await weekly.save(input, editor?.id); setEditor(undefined); onNotice(editor ? "周任务已更新" : "周任务已添加"); }} />}
    {deleting && <Modal title="删除周任务" busy={weekly.busy} onClose={() => setDeleting(null)}>
      <p>确定删除「{deleting.name}」？已安排到每日清单的任务仍然保留。</p>
      {weekly.error && <p className="error-box" role="alert">{weekly.error}</p>}
      <div className="dialog-actions"><button className="button" disabled={weekly.busy} onClick={() => setDeleting(null)}>取消</button><button className="button primary" disabled={weekly.busy} onClick={() => void weekly.remove(deleting.id).then(() => { setDeleting(null); onNotice("周任务已删除"); }).catch(() => {})}>{weekly.busy ? "正在删除…" : "确认删除"}</button></div>
    </Modal>}
  </>;
}

function WeeklyEditor({ task, week, onSave, onClose }: {
  task: WeeklyTask | null; week: string; onSave: (input: { name: string; priority: Priority }) => Promise<void>; onClose: () => void;
}) {
  const [name, setName] = useState(task?.name || "");
  const [priority, setPriority] = useState<Priority>(task?.priority || "medium");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  return <Modal title={task ? "编辑周任务" : "添加周任务"} busy={busy} onClose={onClose}>
    <p className="muted">{weekRange(week)} · 周一至周日</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); if (lock.current) return;
      lock.current = true; setBusy(true); setError("");
      try { await onSave({ name, priority }); }
      catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); }
      finally { lock.current = false; setBusy(false); }
    }}>
      <label className="field">周任务名称<textarea data-autofocus required maxLength={500} rows={3} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="例如：完成本周客户方案并提交评审" /></label>
      <label className="field">周任务优先级<select value={priority} disabled={busy} onChange={(event) => setPriority(event.target.value as Priority)}><option value="high">高优先级</option><option value="medium">中优先级</option><option value="low">低优先级</option></select></label>
      {error && <p role="alert" className="error-box">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? "正在保存…" : "保存周任务"}</button></div>
    </form>
  </Modal>;
}
