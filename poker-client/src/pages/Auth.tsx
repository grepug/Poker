import React, { useMemo, useState } from "react";
import { PLAYER_EMOJI_OPTIONS, getRandomPlayerEmoji } from "@/constants/player-emojis";
import { useAuth } from "@/contexts/AuthContext";

export const AuthPage: React.FC = () => {
  const {
    authModes,
    passkeySupported,
    registerWithPasskey,
    loginWithPasskey,
    loginWithPassword,
  } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState(() => getRandomPlayerEmoji());
  const [accountId, setAccountId] = useState("test1");
  const [password, setPassword] = useState("test1234");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const passkeyDisabled = useMemo(
    () => isSubmitting || !passkeySupported,
    [isSubmitting, passkeySupported],
  );

  const handlePasskeyRegister = async () => {
    const name = displayName.trim();
    if (!name) {
      setFeedback("请先输入显示用户名");
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      await registerWithPasskey(name, avatarEmoji);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "注册失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      await loginWithPasskey();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Passkey 登录失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordLogin = async () => {
    const normalizedAccount = accountId.trim();
    if (!normalizedAccount) {
      setFeedback("请输入测试账号");
      return;
    }

    if (password.length < 8) {
      setFeedback("密码至少 8 位");
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      await loginWithPassword(normalizedAccount, password);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "账号密码登录失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 md:px-6 md:py-12">
      <div className="relative mx-auto flex min-h-[85vh] w-full max-w-4xl items-center justify-center">
        <section className="surface-panel w-full max-w-lg space-y-6 p-6 md:p-8" data-testid="auth-page">
          <div className="space-y-2 text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">User System</p>
            <h1 className="text-3xl font-black tracking-tight text-white">登录 Poker</h1>
            <p className="text-sm text-emerald-100/75">
              默认推荐使用 Passkey。测试环境支持账号密码（test1/test2/test3）。
            </p>
          </div>

          <div className="space-y-4 rounded-xl border border-emerald-700/60 bg-emerald-950/40 p-4">
            <h2 className="text-sm font-semibold text-emerald-100">Passkey 注册</h2>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="显示用户名（全局唯一）"
              className="w-full rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-3 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
            />

            <div className="grid grid-cols-10 gap-1">
              {PLAYER_EMOJI_OPTIONS.slice(0, 30).map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAvatarEmoji(emoji)}
                  className={`h-9 rounded-lg text-xl transition ${
                    avatarEmoji === emoji
                      ? "bg-emerald-400/25 ring-1 ring-emerald-300/80"
                      : "hover:bg-emerald-500/15"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={passkeyDisabled}
              onClick={handlePasskeyRegister}
              className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              用 Passkey 注册并登录
            </button>

            <button
              type="button"
              disabled={passkeyDisabled}
              onClick={handlePasskeyLogin}
              className="w-full rounded-xl border border-emerald-500/70 bg-transparent px-4 py-3 font-semibold text-emerald-200 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              我已有 Passkey，直接登录
            </button>

            {!passkeySupported && (
              <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                当前浏览器不支持 Passkey，请升级浏览器或使用系统浏览器。
              </p>
            )}
          </div>

          {authModes.password && (
            <div className="space-y-3 rounded-xl border border-sky-700/60 bg-sky-950/25 p-4">
              <h2 className="text-sm font-semibold text-sky-100">测试账号密码登录</h2>
              <input
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                placeholder="账号（test1/test2/test3）"
                className="w-full rounded-xl border border-sky-700/60 bg-sky-950/50 px-4 py-3 text-white outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/35"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="密码"
                className="w-full rounded-xl border border-sky-700/60 bg-sky-950/50 px-4 py-3 text-white outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/35"
              />
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handlePasswordLogin}
                className="w-full rounded-xl bg-sky-500 px-4 py-3 font-semibold text-sky-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                用测试账号登录
              </button>
            </div>
          )}

          {feedback && (
            <p className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {feedback}
            </p>
          )}
        </section>
      </div>
    </main>
  );
};
