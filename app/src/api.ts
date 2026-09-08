import { supabase, url, anon } from "./client";
import type { Task, Metadata } from "./types";
const fields =
  "id,user_id,name,priority,completed,reminder_at,reminder_method,elapsed_seconds,completed_at,created_at,updated_at";
export function fail(error: unknown): never {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "请求失败，请检查网络后重试";
  throw new Error(message);
}
export const api = {
  async get(userId: string, id: string): Promise<Task> {
    const { data, error } = await supabase
      .from("tasks")
      .select(fields)
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (error) fail(error);
    return data as Task;
  },
  async list(userId: string): Promise<Task[]> {
    const all: Task[] = [];
    let cursor = "";
    for (;;) {
      let query = supabase
        .from("tasks")
        .select(fields)
        .eq("user_id", userId)
        .order("id")
        .limit(500);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query;
      if (error) fail(error);
      all.push(...((data || []) as Task[]));
      if (!data || data.length < 500) return all;
      cursor = data[data.length - 1].id;
    }
  },
  async metadata(userId: string): Promise<Metadata> {
    const { data, error } = await supabase.auth.getUser();
    if (error) fail(error);
    if (!data.user || data.user.id !== userId)
      throw new Error("账号已切换，请在当前账号重新操作");
    return data.user.user_metadata || {};
  },
  async patchMetadata(userId: string, patch: Metadata): Promise<Metadata> {
    const current = await api.metadata(userId);
    const settings = Object.fromEntries(
      Object.entries({ ...current, ...patch }).filter(([key]) =>
        key.startsWith("dtl_"),
      ),
    );
    if (new TextEncoder().encode(JSON.stringify(settings)).byteLength > 6000)
      throw new Error("重复任务设置空间已满，请先删除不用的规则或缩短名称");
    const { data, error } = await supabase.auth.getSession();
    if (error) fail(error);
    if (!data.session || data.session.user.id !== userId)
      throw new Error("账号已切换，操作已取消");
    // Capture the verified user's token. Do not let a queued request use a new account.
    const response = await fetch(`${url}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${data.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: patch }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok)
      fail({ message: result.msg || result.message || "设置保存失败" });
    if (result.id !== userId) throw new Error("账号验证失败");
    return result.user_metadata || {};
  },
  async create(task: Task): Promise<Task> {
    const { data, error } = await supabase
      .from("tasks")
      .insert(task)
      .select(fields)
      .single();
    if (error) fail(error);
    if (!data) throw new Error("任务未保存");
    return data as Task;
  },
  async insertOnce(rows: Task[]): Promise<Task[]> {
    if (!rows.length) return [];
    // PK + ON CONFLICT DO NOTHING is atomic, including simultaneous devices/retries.
    const { data, error } = await supabase
      .from("tasks")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
      .select(fields);
    if (error) fail(error);
    return (data || []) as Task[];
  },
  async update(
    userId: string,
    id: string,
    patch: Partial<Task>,
  ): Promise<Task> {
    const { data, error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select(fields)
      .single();
    if (error) fail(error);
    if (!data) throw new Error("任务不存在，请刷新列表");
    return data as Task;
  },
  async saveElapsed(
    userId: string,
    id: string,
    seconds: number,
  ): Promise<Task> {
    // Atomic monotonic guard prevents an older device's save from decreasing time.
    const { data, error } = await supabase
      .from("tasks")
      .update({ elapsed_seconds: seconds })
      .eq("id", id)
      .eq("user_id", userId)
      .lte("elapsed_seconds", seconds)
      .select(fields)
      .maybeSingle();
    if (error) fail(error);
    if (data) return data as Task;
    const latest = await supabase
      .from("tasks")
      .select(fields)
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (latest.error) fail(latest.error);
    return latest.data as Task;
  },
  async remove(userId: string, id: string): Promise<void> {
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) fail(error);
  },
};
