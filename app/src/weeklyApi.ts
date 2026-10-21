import { supabase } from "./client";
import type { WeeklyTask, WeeklyTaskInput } from "./types";
import { syncRows, type RowVersion } from "./sync";

const fields = "id,user_id,week_start,name,priority,completed,completed_at,created_at,updated_at";
function check(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (error.code === "PGRST205" || error.code === "42P01")
    throw new Error("周计划尚未启用，请先完成数据库升级。每日任务可继续使用。");
  throw new Error(error.message);
}
export const weeklyApi = {
  async sync(userId: string, week: string, previous: WeeklyTask[]): Promise<WeeklyTask[]> {
    return syncRows(previous, async () => {
      const versions: RowVersion[] = [];
      let cursor = "";
      for (;;) {
        let query = supabase.from("weekly_tasks").select("id,updated_at").eq("user_id", userId).eq("week_start", week).order("id").limit(500);
        if (cursor) query = query.gt("id", cursor);
        const { data, error } = await query;
        check(error);
        versions.push(...(data || []));
        if (!data || data.length < 500) return versions;
        cursor = data[data.length - 1].id;
      }
    }, async (ids) => {
      const { data, error } = await supabase.from("weekly_tasks").select(fields).eq("user_id", userId).eq("week_start", week).in("id", ids);
      check(error);
      return (data || []) as WeeklyTask[];
    });
  },
  async list(userId: string, week?: string): Promise<WeeklyTask[]> {
    const rows: WeeklyTask[] = [];
    let cursor = "";
    for (;;) {
      let query = supabase.from("weekly_tasks").select(fields).eq("user_id", userId).order("id").limit(500);
      if (week) query = query.eq("week_start", week);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query;
      check(error);
      rows.push(...(data || []) as WeeklyTask[]);
      if (!data || data.length < 500) return rows;
      cursor = data[data.length - 1].id;
    }
  },
  async create(row: WeeklyTask): Promise<WeeklyTask> {
    // A lost response can be retried without duplicating or overwriting a plan.
    const inserted = await supabase.from("weekly_tasks").upsert(row, { onConflict: "id", ignoreDuplicates: true });
    check(inserted.error);
    const { data, error } = await supabase.from("weekly_tasks").select(fields).eq("user_id", row.user_id).eq("id", row.id).single();
    check(error);
    return data as WeeklyTask;
  },
  async update(userId: string, id: string, patch: WeeklyTaskInput | Pick<WeeklyTask, "completed" | "completed_at">): Promise<WeeklyTask> {
    const { data, error } = await supabase.from("weekly_tasks").update(patch).eq("user_id", userId).eq("id", id).select(fields).single();
    check(error);
    return data as WeeklyTask;
  },
  async remove(userId: string, id: string): Promise<void> {
    const { error } = await supabase.from("weekly_tasks").delete().eq("user_id", userId).eq("id", id);
    check(error);
  },
};
