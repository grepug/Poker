import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PLAYER_EMOJI_OPTIONS } from "@/constants/player-emojis";
import { useAuth } from "@/contexts/AuthContext";

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, updateProfile, logout } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("🙂");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }
    setDisplayName(user.displayName);
    setAvatarEmoji(user.avatarEmoji);
  }, [user]);

  const handleSave = async () => {
    setIsSaving(true);
    setFeedback(null);
    try {
      await updateProfile(displayName, avatarEmoji);
      setFeedback("设置已保存");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/auth", { replace: true });
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 md:px-6 md:py-12">
      <div className="relative mx-auto flex min-h-[85vh] w-full max-w-4xl items-center justify-center">
        <section className="surface-panel w-full max-w-lg space-y-6 p-6 md:p-8" data-testid="settings-page">
          <header className="space-y-2">
            <h1 className="text-3xl font-black tracking-tight text-white">用户设置</h1>
            <p className="text-sm text-emerald-100/75">
              编辑你的显示用户名和头像 emoji。保存后会同步到当前牌桌。
            </p>
          </header>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-emerald-100">显示用户名</label>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-3 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-emerald-100">
              头像 emoji（当前：{avatarEmoji}）
            </label>
            <div className="grid max-h-52 grid-cols-10 gap-1 overflow-y-auto rounded-xl border border-emerald-700/60 bg-emerald-950/40 p-2">
              {PLAYER_EMOJI_OPTIONS.map((emoji) => (
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
          </div>

          {feedback && (
            <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {feedback}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              保存设置
            </button>
            <button
              type="button"
              onClick={() => navigate("/", { replace: true })}
              className="rounded-xl border border-emerald-500/70 px-4 py-3 font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
            >
              返回大厅
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl border border-rose-500/70 px-4 py-3 font-semibold text-rose-200 transition hover:bg-rose-500/15"
            >
              退出登录
            </button>
          </div>
        </section>
      </div>
    </main>
  );
};
