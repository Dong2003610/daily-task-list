import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  Plus,
  Search,
  Timer,
  Pause,
  Play,
  Square,
  Pencil,
  Trash2,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Repeat2,
  ArrowRight,
  CalendarDays,
  LogOut,
  RefreshCw,
  Bell,
  CheckCheck,
  ListTodo,
  Clock3,
} from "lucide-react";
import { supabase } from "./client";
import { useWorkspace } from "./useWorkspace";
import { useFocusTimer } from "./useFocusTimer";
import { useReminders } from "./useReminders";
import { TaskEditor } from "./TaskEditor";
import { RepeatPanel } from "./RepeatPanel";
import { Modal } from "./Modal";
import {
  carryCandidates,
  cancelledSources,
  dayKey,
  yesterday,
  dayLabel,
  formatDuration,
  PRIORITY,
  CARRY_PROMPT,
  TIMEZONE,
  rulesFromMetadata,
  exportCsv,
  sortTasks,
} from "./domain";
import { readLocal } from "./storage";
import type { Task, Priority, TimerMode } from "./types";

export function App({ user }: { user: User }) {
  const workspace = useWorkspace(user),
    timer = useFocusTimer(user.id, workspace.tasks, workspace.saveElapsed),
    reminders = useReminders(user.id, workspace.tasks);
  const [day, setDay] = useState(dayKey),
    [view, setView] = useState<"today" | "history">("today"),
    [search, setSearch] = useState(""),
    [date, setDate] = useState(""),
    [filter, setFilter] = useState("all");
  const [quick, setQuick] = useState(""),
    [priority, setPriority] = useState<Priority>("medium"),
    [adding, setAdding] = useState(false),
    quickLock = useRef(false);
  const [editor, setEditor] = useState<Task | null | undefined>(undefined),
    [repeatOpen, setRepeatOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [carryOpen, setCarryOpen] = useState<"yesterday" | "all" | null>(null);
  const [notice, setNotice] = useState(""),
    [actionError, setActionError] = useState(""),
    [timerExpanded, setTimerExpanded] = useState(false),
    [timerMode, setTimerMode] = useState<TimerMode>("countup"),
    [minutes, setMinutes] = useState(25);
  const asked = useRef(""),
    generated = useRef(""),
    generateLock = useRef(false),
    [retryTick, setRetryTick] = useState(0);
  const rules = useMemo(
    () => rulesFromMetadata(workspace.metadata),
    [workspace.metadata],
  );
  const candidates = useMemo(
    () =>
      carryCandidates(
        workspace.tasks,
        day,
        cancelledSources(workspace.metadata),
      ),
    [workspace.tasks, workspace.metadata, day],
  );
  const todayTasks = useMemo(
    () => workspace.tasks.filter((t) => dayKey(t.created_at) === day),
    [workspace.tasks, day],
  );
  const done = todayTasks.filter((t) => t.completed).length;
  const reminder = reminders.pending[0];
  const rulesKey = JSON.stringify(
    Object.fromEntries(
      Object.entries(workspace.metadata).filter(
        ([k]) => k.startsWith("dtl_rule_") || k.startsWith("dtl_skip_"),
      ),
    ),
  );
  const act = async (job: () => Promise<unknown>, success = "") => {
    setActionError("");
    try {
      await job();
      if (success) setNotice(success);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "操作失败，请重试");
    }
  };
  useEffect(() => {
    const check = () => {
      setDay(dayKey());
      setRetryTick((n) => n + 1);
    };
    const handleVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const t = setInterval(check, 30000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    const key = day + rulesKey;
    if (
      !workspace.ready ||
      !workspace.online ||
      generated.current === key ||
      generateLock.current
    )
      return;
    if (!rules.some((r) => r.enabled && !r.deleted)) {
      generated.current = key;
      return;
    }
    generateLock.current = true;
    workspace
      .generateRepeats()
      .then(() => {
        generated.current = key;
      })
      .catch(() => {})
      .finally(() => {
        generateLock.current = false;
      });
  }, [
    workspace.ready,
    workspace.online,
    workspace.generateRepeats,
    day,
    rulesKey,
    retryTick,
  ]);
  useEffect(() => {
    if (
      !workspace.ready ||
      workspace.loading ||
      asked.current === day ||
      editor !== undefined ||
      repeatOpen ||
      exportOpen ||
      reminder
    )
      return;
    asked.current = day;
    if (
      workspace.metadata[CARRY_PROMPT] === day ||
      readLocal(`dtl:carry:${user.id}`, "") === day
    )
      return;
    if (candidates.some((t) => dayKey(t.created_at) === yesterday(day)))
      setCarryOpen("yesterday");
  }, [
    day,
    workspace.ready,
    workspace.loading,
    workspace.metadata,
    candidates,
    user.id,
    editor,
    repeatOpen,
    exportOpen,
    reminder,
  ]);
  const visible = useMemo(
    () =>
      sortTasks(
        workspace.tasks.filter((t) => {
          const taskDay = dayKey(t.created_at),
            needle = search.trim().toLocaleLowerCase();
          if (
            view === "today"
              ? taskDay !== day
              : date
                ? taskDay !== date
                : taskDay === day
          )
            return false;
          return (
            (!needle || t.name.toLocaleLowerCase().includes(needle)) &&
            (filter === "all" ||
              (filter === "done" ? t.completed : !t.completed))
          );
        }),
      ),
    [workspace.tasks, view, date, day, search, filter],
  );
  const groups = useMemo(() => {
    const result: Record<string, Task[]> = {};
    for (const task of visible) {
      const key = dayKey(task.created_at);
      (result[key] ??= []).push(task);
    }
    return Object.entries(result).sort(([a], [b]) => b.localeCompare(a));
  }, [visible]);
  const syncText = !workspace.online
    ? "网络已断开"
    : workspace.pending
      ? "正在保存…"
      : workspace.error
        ? "同步失败"
        : workspace.loading
          ? "正在同步…"
          : workspace.deletions.length
            ? "等待删除确认…"
            : "已同步";
  const busy = workspace.pending > 0;
  const download = (format: "json" | "csv") => {
    const data =
      format === "csv"
        ? exportCsv(workspace.allTasks)
        : JSON.stringify(
            {
              format: "daily-task-list",
              version: 2,
              exportedAt: new Date().toISOString(),
              timezone: TIMEZONE,
              tasks: workspace.allTasks,
              settings: Object.fromEntries(
                Object.entries(workspace.metadata).filter(([k]) =>
                  k.startsWith("dtl_"),
                ),
              ),
            },
            null,
            2,
          );
    const url = URL.createObjectURL(
      new Blob([data], {
        type:
          format === "csv"
            ? "text/csv;charset=utf-8"
            : "application/json;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `每日任务清单-${day}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("备份已导出");
    setExportOpen(false);
  };
  return (
    <main className="workspace">
      <header className="page-header">
        <div className="brand">
          <div className="brand-mark">
            <CheckCheck size={24} />
          </div>
          <div>
            <p className="eyebrow">DAILY TASK LIST</p>
            <h1>每日任务清单</h1>
            <p className="subtitle">清晰规划，高效完成每一天</p>
          </div>
        </div>
        <div className="header-actions">
          <span
            className={`sync-status ${workspace.error || !workspace.online ? "warning" : ""}`}
            role="status"
            title={
              workspace.lastSaved
                ? `上次同步：${new Date(workspace.lastSaved).toLocaleString()}`
                : ""
            }
          >
            <span className="status-dot" />
            {syncText}
          </span>
          <button
            className="icon-button"
            aria-label="刷新同步"
            disabled={busy}
            onClick={() => void workspace.refresh()}
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="button quiet"
            disabled={
              busy ||
              timer.running ||
              Boolean(timer.error) ||
              workspace.deletions.length > 0
            }
            title="请先暂停计时并等待保存后退出"
            onClick={() =>
              void act(async () => {
                const { error } = await supabase.auth.signOut();
                if (error) throw error;
              })
            }
          >
            <LogOut size={16} />
            退出
          </button>
        </div>
      </header>
      {(workspace.error || actionError || timer.error) && (
        <div className="error-box error-banner" role="alert">
          <span>{actionError || timer.error || workspace.error}</span>
          <button
            className="text-button"
            onClick={() => {
              setActionError("");
              timer.clearError();
              void workspace.refresh();
              setRetryTick((n) => n + 1);
            }}
          >
            重试同步
          </button>
        </div>
      )}
      {!workspace.online && (
        <div className="offline-banner">
          当前离线，已加载的任务仍可查看。新任务与编辑内容会保留在输入框中，请联网后保存。
        </div>
      )}
      <section className="day-heading">
        <div>
          <p className="eyebrow">
            今天 ·{" "}
            {new Date(day + "T12:00:00+08:00").toLocaleDateString("zh-CN", {
              timeZone: TIMEZONE,
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </p>
          <h2>把注意力留给重要的事</h2>
        </div>
        <div className="tools">
          <button
            className="button quiet"
            disabled={!workspace.ready}
            onClick={() => setRepeatOpen(true)}
          >
            <Repeat2 size={17} />
            重复任务
          </button>
          <button
            className="button quiet"
            disabled={!workspace.ready}
            onClick={() => setExportOpen(true)}
          >
            <Download size={17} />
            导出备份
          </button>
        </div>
      </section>
      <section className="progress-panel panel" aria-label="今日完成进度">
        <div className="progress-heading">
          <div>
            <span className="progress-label">今日进度</span>
            <strong>
              {done}
              <small> / {todayTasks.length} 项已完成</small>
            </strong>
          </div>
          <span className="progress-percent">
            {todayTasks.length
              ? Math.round((done / todayTasks.length) * 100)
              : 0}
            <small>%</small>
          </span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="今日完成百分比"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            todayTasks.length ? Math.round((done / todayTasks.length) * 100) : 0
          }
        >
          <div
            style={{
              width: `${todayTasks.length ? (done / todayTasks.length) * 100 : 0}%`,
            }}
          />
        </div>
      </section>
      <div className="main-grid">
        <section className="task-area">
          <form
            className="quick-add panel"
            onSubmit={async (e) => {
              e.preventDefault();
              if (quickLock.current || !quick.trim()) return;
              quickLock.current = true;
              setAdding(true);
              setActionError("");
              try {
                await workspace.add({
                  name: quick,
                  priority,
                  reminder_at: null,
                  reminder_method: null,
                });
                setQuick("");
                setView("today");
                setSearch("");
                setFilter("all");
                setNotice("任务已添加");
              } catch (e) {
                setActionError(e instanceof Error ? e.message : "添加失败");
              } finally {
                quickLock.current = false;
                setAdding(false);
              }
            }}
          >
            <Plus size={20} className="muted" />
            <input
              aria-label="快速添加任务"
              placeholder="今天要做什么？输入后按回车"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              maxLength={500}
              disabled={adding}
            />
            <select
              aria-label="快速任务优先级"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              disabled={adding}
            >
              <option value="medium">中优先级</option>
              <option value="high">高优先级</option>
              <option value="low">低优先级</option>
            </select>
            <button
              className="button primary"
              disabled={adding || !workspace.ready || !quick.trim()}
            >
              {adding ? "保存中" : "添加"}
            </button>
          </form>
          <div className="quick-secondary">
            <span>回车快速添加 · 详细设置可添加提醒</span>
            <button
              className="text-button"
              onClick={() => setEditor(null)}
              disabled={!workspace.ready}
            >
              详细添加 <ArrowRight size={14} />
            </button>
          </div>
          {candidates.length > 0 && (
            <button
              className="carry-banner"
              onClick={() => setCarryOpen("all")}
            >
              <span className="carry-icon">
                <CalendarDays size={20} />
              </span>
              <span>
                <strong>{candidates.length} 项未完成任务等待继续</strong>
                <small>查看昨天及更早的任务，自选迁移到今天</small>
              </span>
              <ArrowRight size={18} />
            </button>
          )}
          <div className="list-toolbar">
            <div className="tabs" role="tablist" aria-label="任务视图">
              <button
                role="tab"
                aria-selected={view === "today"}
                className={view === "today" ? "active" : ""}
                onClick={() => setView("today")}
              >
                今日任务 <span>{todayTasks.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={view === "history"}
                className={view === "history" ? "active" : ""}
                onClick={() => setView("history")}
              >
                历史任务
              </button>
            </div>
            <select
              aria-label="完成状态筛选"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">全部状态</option>
              <option value="open">未完成</option>
              <option value="done">已完成</option>
            </select>
          </div>
          <div className="search-bar">
            <label className="search-field">
              <Search size={17} />
              <input
                aria-label="搜索任务"
                placeholder={
                  view === "today" ? "搜索今日任务" : "搜索历史任务名称"
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {view === "history" && (
              <label className="date-field">
                <CalendarDays size={16} />
                <input
                  aria-label="历史日期"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                {date && (
                  <button
                    className="text-button"
                    aria-label="清除日期"
                    onClick={() => setDate("")}
                  >
                    清除
                  </button>
                )}
              </label>
            )}
          </div>
          {workspace.loading ? (
            <div className="empty-state panel">
              <RefreshCw className="spin" />
              <h3>正在加载任务…</h3>
            </div>
          ) : !visible.length ? (
            <div className="empty-state panel">
              <ListTodo size={32} />
              <h3>
                {search || filter !== "all" || date
                  ? "没有符合条件的任务"
                  : view === "today"
                    ? "今天，从一件小事开始"
                    : "这里会留下你的工作记录"}
              </h3>
              <p>
                {search || filter !== "all" || date
                  ? "试试其他关键词或清除筛选条件。"
                  : "在上方添加任务，安排今天的第一步。"}
              </p>
              {(search || filter !== "all" || date) && (
                <button
                  className="button"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                    setDate("");
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
          ) : (
            <div className="task-groups">
              {groups.map(([group, tasks]) => (
                <section key={group}>
                  {view === "history" && (
                    <h3 className="group-heading">
                      {dayLabel(group, day)} <small>{tasks.length} 项</small>
                    </h3>
                  )}
                  <div className="task-list">
                    {tasks.map((task) => (
                      <article
                        key={task.id}
                        className={`task-card panel ${task.completed ? "completed" : ""} ${timer.taskId === task.id ? "is-timing" : ""}`}
                        data-testid="task-card"
                      >
                        <button
                          className={`complete-button ${task.completed ? "checked" : ""}`}
                          disabled={busy}
                          aria-label={`${task.completed ? "标记未完成" : "完成"}：${task.name}`}
                          aria-pressed={task.completed}
                          onClick={() =>
                            void act(() => workspace.toggle(task.id))
                          }
                        >
                          {task.completed && <Check size={17} />}
                        </button>
                        <div className="task-content">
                          <div className="task-title">
                            <h3>{task.name}</h3>
                            <span className={`priority ${task.priority}`}>
                              {PRIORITY[task.priority]}
                            </span>
                          </div>
                          <div className="task-meta">
                            {task.reminder_at && (
                              <span>
                                <Bell size={12} />
                                {new Date(task.reminder_at).toLocaleString(
                                  "zh-CN",
                                  {
                                    timeZone: TIMEZONE,
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </span>
                            )}
                            {task.elapsed_seconds > 0 && (
                              <span>
                                <Clock3 size={12} />
                                已用 {formatDuration(task.elapsed_seconds)}
                              </span>
                            )}
                            {timer.taskId === task.id && (
                              <span className="timing-label">
                                {timer.running ? "正在专注" : "计时已暂停"}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="task-actions">
                          <button
                            className="icon-button"
                            disabled={task.completed}
                            aria-label={`计时：${task.name}`}
                            onClick={() => {
                              setTimerExpanded(true);
                              if (timer.taskId === task.id) {
                                timer.running ? timer.pause() : timer.resume();
                              } else timer.start(task, timerMode, minutes);
                            }}
                          >
                            <Timer size={17} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`编辑：${task.name}`}
                            disabled={busy}
                            onClick={() => setEditor(task)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-button danger"
                            aria-label={`删除：${task.name}`}
                            disabled={busy}
                            onClick={() => {
                              if (timer.taskId === task.id) timer.pause();
                              workspace.scheduleDelete(task);
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
        <aside
          className={`timer-panel panel ${timerExpanded ? "expanded" : ""} ${timer.task ? "has-task" : ""}`}
        >
          <button
            className="timer-summary"
            onClick={() => setTimerExpanded(!timerExpanded)}
            aria-expanded={timerExpanded}
            aria-label="展开或收起计时器"
          >
            <span className="timer-icon">
              <Timer size={21} />
            </span>
            <span>
              <strong>专注计时</strong>
              <small>{timer.task?.name || "选择一项任务，开始专注"}</small>
            </span>
            <span className="mobile-time">
              {formatDuration(
                timer.mode === "countdown" ? timer.remaining : timer.elapsed,
              )}
            </span>
            {timerExpanded ? (
              <ChevronUp className="mobile-chevron" size={18} />
            ) : (
              <ChevronDown className="mobile-chevron" size={18} />
            )}
          </button>
          <div className="timer-body">
            <div className="timer-display">
              <span>
                {formatDuration(
                  timer.mode === "countdown" ? timer.remaining : timer.elapsed,
                )}
              </span>
              <small>
                {timer.running
                  ? "专注进行中"
                  : timer.task
                    ? "准备好了，就继续"
                    : "一次只做一件事"}
              </small>
            </div>
            <label className="field">
              计时方式
              <select
                value={timerMode}
                disabled={timer.running}
                onChange={(e) => setTimerMode(e.target.value as TimerMode)}
              >
                <option value="countup">正计时</option>
                <option value="countdown">倒计时</option>
              </select>
            </label>
            {timerMode === "countdown" && (
              <label className="field">
                倒计时分钟
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={minutes}
                  disabled={timer.running}
                  onChange={(e) =>
                    setMinutes(
                      Math.min(480, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                />
              </label>
            )}
            <div className="timer-controls">
              <button
                className="button primary"
                disabled={!timer.task || timer.task.completed}
                onClick={() => {
                  if (!timer.task) return;
                  if (timer.running) timer.pause();
                  else if (
                    timer.mode !== timerMode ||
                    (timer.mode === "countdown" && timer.remaining === 0)
                  )
                    timer.start(timer.task, timerMode, minutes);
                  else timer.resume();
                }}
              >
                {timer.running ? <Pause size={16} /> : <Play size={16} />}{" "}
                {timer.running
                  ? "暂停"
                  : timer.mode === "countdown" &&
                      timer.remaining === 0 &&
                      timer.task
                    ? "重新开始"
                    : "继续"}
              </button>
              <button
                className="button"
                disabled={!timer.task}
                onClick={timer.stop}
              >
                <Square size={15} />
                停止
              </button>
            </div>
            <p className="timer-hint">
              点击任务旁的计时按钮开始。暂停或切换任务时保存进度。
            </p>
          </div>
        </aside>
      </div>
      <footer className="page-footer">
        每完成一件小事，都在向前一步。
        <span>任务随账号同步 · 北京时间（UTC+8） · v2.0</span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          {notice}
        </div>
      )}
      {workspace.deletions.length > 0 && (
        <div className="undo-stack" aria-live="polite">
          {workspace.deletions.map((item) => (
            <div className="undo-toast" key={item.task.id}>
              <span>
                {item.status === "failed"
                  ? "删除尚未完成，记录已保留"
                  : item.status === "committing"
                    ? "正在删除"
                    : "即将删除"}
                「{item.task.name}」
              </span>
              <button
                className="text-button"
                disabled={
                  item.status === "committing" ||
                  (!item.status &&
                    Date.now() >= item.deadline &&
                    workspace.online)
                }
                onClick={() =>
                  item.status === "failed"
                    ? workspace.retryDelete(item.task.id)
                    : workspace.undoDelete(item.task.id)
                }
              >
                {item.status === "failed"
                  ? "重试删除"
                  : item.status === "committing"
                    ? "删除中…"
                    : "撤销"}
              </button>
            </div>
          ))}
        </div>
      )}
      {editor !== undefined && (
        <TaskEditor
          task={editor}
          onClose={() => setEditor(undefined)}
          onSave={async (input) => {
            if (editor) await workspace.update(editor.id, input);
            else await workspace.add(input);
            setNotice(editor ? "任务已更新" : "任务已添加");
          }}
        />
      )}
      {repeatOpen && (
        <RepeatPanel
          rules={rules}
          onClose={() => setRepeatOpen(false)}
          onSave={workspace.saveRule}
        />
      )}
      {exportOpen && (
        <Modal title="导出任务备份" onClose={() => setExportOpen(false)}>
          <p className="muted">
            包含账号下的全部任务，不受当前搜索和日期筛选影响。待撤销的删除项也会保留在备份中。
          </p>
          <div className="export-options">
            <button className="button" onClick={() => download("csv")}>
              <Download size={18} />
              导出 CSV 表格
            </button>
            <button className="button primary" onClick={() => download("json")}>
              <Download size={18} />
              导出 JSON 完整备份
            </button>
          </div>
          <p className="muted small">
            CSV 方便用表格软件查看；JSON
            额外包含重复任务规则与设置，不包含登录凭据。
          </p>
        </Modal>
      )}
      {carryOpen && (
        <CarryPicker
          key={day}
          candidates={candidates}
          day={day}
          mode={carryOpen}
          onSkip={async () => {
            await workspace.dismissCarry();
            setCarryOpen(null);
          }}
          onClose={() => setCarryOpen(null)}
          onConfirm={async (ids) => {
            const count = await workspace.carry(ids, day);
            setCarryOpen(null);
            setView("today");
            setSearch("");
            setFilter("all");
            setNotice(
              count
                ? `已迁移 ${count} 项任务到今天`
                : "所选任务已处理，列表已更新",
            );
          }}
        />
      )}
      {reminder &&
        !carryOpen &&
        editor === undefined &&
        !repeatOpen &&
        !exportOpen && (
          <Modal
            title="任务提醒"
            className="reminder-dialog"
            onClose={() => reminders.dismiss(reminder)}
          >
            <div className="reminder-symbol">
              <Bell size={38} />
            </div>
            <h3 className="reminder-name">{reminder.name}</h3>
            <p>
              {reminder.reminder_at &&
              Date.now() - Date.parse(reminder.reminder_at) > 60000
                ? "你可能错过了这项提醒。"
                : "到时间了，开始处理这项任务吧。"}
            </p>
            <p className="muted">
              提醒时间：
              {new Date(reminder.reminder_at!).toLocaleString("zh-CN", {
                timeZone: TIMEZONE,
              })}
            </p>
            <div className="dialog-actions">
              <button className="button" onClick={reminders.playSound}>
                播放提示音
              </button>
              <button
                className="button primary"
                onClick={() => reminders.dismiss(reminder)}
              >
                知道了
                {reminders.pending.length > 1
                  ? `（还有 ${reminders.pending.length - 1} 项）`
                  : ""}
              </button>
            </div>
          </Modal>
        )}
    </main>
  );
}
function CarryPicker({
  candidates,
  day,
  mode,
  onClose,
  onSkip,
  onConfirm,
}: {
  candidates: Task[];
  day: string;
  mode: "yesterday" | "all";
  onClose: () => void;
  onSkip: () => Promise<void>;
  onConfirm: (ids: string[]) => Promise<void>;
}) {
  const [scope, setScope] = useState(mode),
    [selected, setSelected] = useState<string[]>(() =>
      mode === "yesterday"
        ? candidates
            .filter((t) => dayKey(t.created_at) === yesterday(day))
            .map((t) => t.id)
        : [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const list = candidates.filter(
    (t) => scope === "all" || dayKey(t.created_at) === yesterday(day),
  );
  const valid = new Set(candidates.map((t) => t.id));
  const chosen = selected.filter((id) => valid.has(id));
  const submit = async (job: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal title="把未完成的事，接到今天" onClose={onClose} busy={busy}>
      <p className="muted">
        复制后保留原来的历史记录，今日计时从零开始。已过期的提醒会清除，未来的提醒继续保留。
      </p>
      <div className="tabs">
        <button
          className={scope === "yesterday" ? "active" : ""}
          onClick={() => setScope("yesterday")}
          disabled={busy}
        >
          昨天
        </button>
        <button
          className={scope === "all" ? "active" : ""}
          onClick={() => setScope("all")}
          disabled={busy}
        >
          全部遗留任务
        </button>
      </div>
      <p className="small muted">
        较早版本复制的同名任务可能没有关联记录，请按需要勾选。
      </p>
      <div className="carry-list">
        {!list.length ? (
          <p className="empty-inline">这里没有待迁移的任务。</p>
        ) : (
          list.map((t) => (
            <label className="carry-row" key={t.id}>
              <input
                type="checkbox"
                disabled={busy}
                checked={chosen.includes(t.id)}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked
                      ? [...prev, t.id]
                      : prev.filter((id) => id !== t.id),
                  )
                }
              />
              <span>
                <strong>{t.name}</strong>
                <small>
                  {dayLabel(dayKey(t.created_at), day)} · {PRIORITY[t.priority]}
                  优先级
                </small>
              </span>
            </label>
          ))
        )}
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          className="button"
          disabled={busy}
          onClick={() => void submit(onSkip)}
        >
          今天不再提示
        </button>
        <button
          className="button primary"
          disabled={busy || !chosen.length}
          onClick={() => void submit(() => onConfirm(chosen))}
        >
          {busy ? "正在保存…" : `迁移 ${chosen.length} 项到今天`}
        </button>
      </div>
    </Modal>
  );
}
