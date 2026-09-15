# 新建个人 Supabase 后端

1. 在 Supabase 创建 **Personal / Free** 组织及一个项目。数据库地区选离自己较近的位置即可；免费计划足够本项目使用。
2. 项目创建完成后，打开 **SQL Editor → New query**，粘贴并运行同目录的 `schema.sql`。
3. 在 **Authentication → Providers → Email** 中确认 Email 已启用。为方便原有“用户名 + 密码”界面使用，可在开发阶段关闭 *Confirm email*；若保持开启，注册后必须完成邮箱验证。
4. 在 **Authentication → URL Configuration** 填写站点 URL：`https://dong2003610.github.io/daily-task-list/`，并将它加入 Redirect URLs。
5. 在 **Project Settings → API** 复制 Project URL 和 `anon` / `publishable` key。它是浏览器可公开使用的项目标识，不是 `service_role` key；绝对不要复制或分享后者。
6. 把两个公开值填入项目根目录的 `.env.local`，再执行 `npm run build` 与发布脚本。

```dotenv
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_ANON_KEY=你的匿名公开密钥
```

旧秒哒后端已暂停时，无法由本项目自动读取旧任务。若之后能临时恢复，可先在旧网站使用 JSON 导出备份；目前新库会从空任务列表开始。
