import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import toast from "react-hot-toast";
import { Spinner } from "../components/ui";
import { parseApiError } from "../utils/format";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@knmp.id");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Login berhasil");
      navigate("/");
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ink-900 via-ink-800 to-brand-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-brand-400/20 blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-hard p-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h1 className="font-display font-semibold text-ink-900 leading-none">
                KNMP Monitor
              </h1>
              <p className="text-xs text-ink-500 mt-1">
                Kampung Nelayan Merah Putih
              </p>
            </div>
          </div>

          <h2 className="text-lg font-display font-semibold text-ink-900 mb-1">
            Masuk ke Akun Anda
          </h2>
          <p className="text-sm text-ink-500 mb-6">
            Gunakan email dan password yang diberikan administrator.
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full py-2.5"
              disabled={loading}
            >
              {loading ? <Spinner size={15} /> : null} Masuk
            </button>
          </form>

          <p className="text-[11px] text-ink-400 text-center mt-6">
            Versi 2.0 — © Kementerian Kelautan dan Perikanan
          </p>
        </div>
      </div>
    </div>
  );
}
