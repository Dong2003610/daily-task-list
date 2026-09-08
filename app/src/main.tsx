import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./client";
import { App } from "./App";
import "./styles.css";

function Root() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setError(error.message);
        setUser(data.session?.user || null);
        setLoading(false);
      })
      .catch(() => {
        if (alive) {
          setError("无法读取登录状态，请刷新重试");
          setLoading(false);
        }
      });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) {
        setUser(session?.user || null);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  if (loading) return <div className="loading-page">正在恢复你的工作空间…</div>;
  return user ? (
    <App key={user.id} user={user} />
  ) : (
    <Login initialError={error} />
  );
}
function Login({ initialError }: { initialError: string }) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [info, setInfo] = useState("");
  return (
    <main className="login-page">
      <section className="panel login-card">
        <div className="brand-mark">✓</div>
        <p className="eyebrow">DAILY TASK LIST</p>
        <h1>每日任务清单</h1>
        <p className="muted">登录你的账号，接着完成今天的工作。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            setInfo("");
            try {
              const email = `${username.trim()}@miaoda.com`;
              const result = signup
                ? await supabase.auth.signUp({ email, password })
                : await supabase.auth.signInWithPassword({ email, password });
              if (result.error) throw result.error;
              if (signup && !result.data.session)
                setInfo("注册成功，请按账号服务提示完成验证后登录。");
            } catch (e) {
              setError(e instanceof Error ? e.message : "登录失败，请重试");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            用户名
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="与你原来使用的用户名一致"
              maxLength={100}
            />
          </label>
          <label className="field">
            密码
            <input
              required
              minLength={6}
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
          {info && <p role="status">{info}</p>}
          <button disabled={busy} className="button primary full">
            {busy ? "请稍候…" : signup ? "注册账号" : "登录"}
          </button>
        </form>
        <button
          disabled={busy}
          className="text-button"
          onClick={() => {
            setSignup(!signup);
            setError("");
            setInfo("");
          }}
        >
          {signup ? "已有账号？去登录" : "没有账号？注册"}
        </button>
      </section>
    </main>
  );
}
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="loading-page">
        <h1>页面遇到了问题</h1>
        <p>已保存的任务仍在账号中。</p>
        <button className="button primary" onClick={() => location.reload()}>
          重新打开
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>,
);
