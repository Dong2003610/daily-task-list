-- 为现有 tasks 表增加可选的手动排序位置。
-- NULL 表示仍使用默认的优先级排序；拖动后客户端会写入递增位置。
alter table public.tasks add column if not exists sort_order bigint;
